import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ── send-sms-campaign — server-side Inforu sender for the serverless funnel ──
// Custom auth: X-Admin-Token header (JWT verification disabled intentionally).
//
// Large-campaign flow (10K+): the dashboard splits recipients into chunks of
// SEND_CHUNK and calls this function once per chunk with a shared
// `clientCampaignId` + `chunkIndex`. Per chunk we:
//   1. register_sms_campaign     — upsert the single campaign run (idempotent)
//   2. claim_sms_campaign_batch  — claim this chunk exactly once (recovery-safe)
//   3. prepare_sms_batch         — mint short-link tokens + filter opt-outs (in DB)
//   4. Inforu SendSms            — personalised token link per recipient
//   5. finish_sms_campaign_batch — record the outcome + roll up campaign counters
// A chunk that was already sent returns { idempotent: true } without re-sending.

const ADMIN_TOKEN = 'nahman-campaign-2026-x7q';
const INFORU_USER = 'Shimon123';
const INFORU_TOKEN = '6ace5d6b-a0f6-42e0-9382-568fdef2ba0c';
const INFORU_API = 'https://capi.inforu.co.il/api/v2/SMS/SendSms';
const FUNNEL_URL = 'https://nahmanbot.com/';
// Public Short.io master link — redirects to FUNNEL_URL with the token in the query.
// The funnel reads the token from ?t=<token> (Short.io normalises bare ?token to token= otherwise).
const SHORT_BASE = 'https://lc76nj.short.gy/zk';
// Central DB (self-hosted Supabase on the client's server)
const SUPA_URL = 'https://db.nahmanbot.com';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODM2MjQzMjcsImV4cCI6MjA5ODk4NDMyN30.2sCfWoZlggpq9uel-e9P_OppsR6NP8xdVvbIAI0d9NM';
const DEFAULT_SENDER = 'Inforu';
const SEND_CHUNK = 500;
// Inforu shortens the personalised token link so the recipient sees Inforu's
// short domain instead of the funnel domain. (Earlier message drops on this
// account were caused by an unregistered Sender ID, not the shortener.)
const SHORTEN_URL = true;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-token, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function toLocalPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('972')) return '0' + d.slice(3);
  if (d.startsWith('0')) return d;
  if (d.length === 9 && d.startsWith('5')) return '0' + d;
  return d;
}

// The funnel reads the token from ?t=<token> so Short.io doesn't normalise it to token=.
function buildTokenLink(token: string): string {
  return `${SHORT_BASE}?t=${token}`;
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

const DEFAULT_MESSAGE = [
  'שלום [#FirstName#],',
  'בדיקת זכאות מהירה — הלוואה או החזר מס, ללא התחייבות:',
  '[#Representative#]',
].join('\n');

interface PreparedRow {
  out_phone: string;
  out_name: string | null;
  out_token: string | null;
  out_opted_out: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const recipients: Array<{ phone: string; name?: string }> = body.recipients || [];
  const campaign = String(body.campaign || 'rehearsal_' + new Date().toISOString().slice(0, 10));
  const sender = String(body.sender || DEFAULT_SENDER).trim() || DEFAULT_SENDER;
  const message = String(body.message || DEFAULT_MESSAGE);
  const dryRun = body.dryRun !== false; // default: dry run! must pass dryRun:false to send

  // ─────────────────────────── DRY RUN (no DB writes) ───────────────────────────
  if (dryRun) {
    let valid = 0;
    const skipped: string[] = [];
    for (const r of recipients) {
      const phone = toLocalPhone(r.phone);
      if (!/^05\d{8}$/.test(phone)) { skipped.push(String(r.phone)); continue; }
      valid++;
    }
    // Preview link with a representative 10-char token so the char count is realistic.
    const sampleLink = buildTokenLink('Ab3kP9xQ2Z');
    const sampleMessage = message
      .replace(/\[#FirstName#\]/g, recipients[0]?.name || '')
      .replace(/\[#Representative#\]/g, sampleLink);
    return json({
      campaign, sender, valid, skipped, dryRun: true,
      sampleLink, linkLength: sampleMessage.length,
      note: 'dry run — nothing sent, no tokens minted',
    });
  }

  // ─────────────────────────── REAL SEND (one chunk) ────────────────────────────
  const clientCampaignId = String(body.clientCampaignId || '');
  const chunkIndex = Number.isFinite(Number(body.chunkIndex)) ? Number(body.chunkIndex) : -1;
  const totalRecipients = Math.max(Number(body.totalRecipients) || recipients.length, 0);
  const totalBatches = Math.max(Number(body.totalBatches) || 1, 1);
  if (!/^[0-9a-fA-F-]{36}$/.test(clientCampaignId) || chunkIndex < 0) {
    return json({ error: 'missing clientCampaignId or chunkIndex' }, 400);
  }
  if (recipients.length > SEND_CHUNK) {
    return json({ error: `chunk too large (max ${SEND_CHUNK})` }, 400);
  }
  if (!message.includes('[#Representative#]')) {
    return json({ error: 'message must contain [#Representative#]' }, 400);
  }

  // 1. Register (or find) the single campaign run — safe to call on every chunk.
  try {
    await rpc<number>('register_sms_campaign', {
      p_client_campaign_id: clientCampaignId,
      p_campaign_name: campaign,
      p_message: message,
      p_sender: sender,
      p_recipient_count: totalRecipients,
      p_total_batches: totalBatches,
    });
  } catch (e) {
    return json({ status: 'error', error: `register failed: ${e}` }, 502);
  }

  // 2. Claim this chunk exactly once.
  let claim: Record<string, unknown>;
  try {
    claim = await rpc<Record<string, unknown>>('claim_sms_campaign_batch', {
      p_client_campaign_id: clientCampaignId,
      p_chunk_index: chunkIndex,
      p_recipient_count: recipients.length,
    });
  } catch (e) {
    return json({ status: 'error', error: `claim failed: ${e}` }, 502);
  }
  if (claim.claimed !== true) {
    const reason = String(claim.reason || 'error');
    if (reason === 'already_sent') {
      // Idempotent: chunk was completed in an earlier run — do not re-send.
      return json({
        idempotent: true,
        sent: Number(claim.sent || 0),
        failed: Number(claim.failed || 0),
        skipped: Number(claim.skipped || 0),
        optedOut: Number(claim.optedOut || 0),
        status: 'sent',
      });
    }
    // processing / unknown / rejected / campaign_not_found → stop the dashboard safely.
    return json({ status: reason, reason, batch: claim }, 409);
  }
  const campaignId = Number(claim.campaign_id);

  // 3. Mint tokens + filter opt-outs inside the DB (dedup within the chunk too).
  let prepared: PreparedRow[];
  try {
    prepared = await rpc<PreparedRow[]>('prepare_sms_batch', {
      p_campaign_id: campaignId,
      p_campaign_name: campaign,
      p_recipients: recipients,
    }) || [];
  } catch (e) {
    await finish('rejected', 0, 0, 0, 0, null, `prepare failed: ${e}`);
    return json({ status: 'rejected', error: `prepare failed: ${e}` }, 502);
  }

  const optedOut = prepared.filter(r => r.out_opted_out).length;
  const invalidSkipped = Math.max(recipients.length - prepared.length, 0);
  const valid = prepared.filter(r => !r.out_opted_out && r.out_token).map(r => ({
    Phone: toLocalPhone(r.out_phone),
    FirstName: r.out_name || '',
    Representative: buildTokenLink(r.out_token as string),
  }));

  // 4. Send via Inforu (one HTTP call — chunk is already ≤ SEND_CHUNK).
  let sent = 0;
  let failed = 0;
  let requestId: string | null = null;
  let sendError: string | null = null;

  if (valid.length > 0) {
    const auth = btoa(`${INFORU_USER}:${INFORU_TOKEN}`);
    try {
      const res = await fetch(INFORU_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          Data: {
            Message: message,
            Recipients: valid,
            Settings: { Sender: sender, CampaignName: campaign, ShortenUrlEnable: SHORTEN_URL, AllowDuplicates: true },
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.StatusId === 1) {
        sent = Number(data.Data?.Recipients) || valid.length;
        requestId = data.RequestId ? String(data.RequestId) : null;
      } else {
        failed = valid.length;
        sendError = data.StatusDescription || `HTTP ${res.status}`;
      }
    } catch (e) {
      failed = valid.length;
      sendError = String(e);
    }
  }

  // 5. Record the outcome. A rejected batch stays retryable (up to 3 attempts).
  const status = sendError ? 'rejected' : 'sent';
  let finishResult: Record<string, unknown> | null = null;
  try {
    finishResult = await finish(status, sent, failed, invalidSkipped, optedOut, requestId, sendError);
  } catch (_) { /* counters are best-effort; never lose the send result */ }

  if (sendError) {
    // Non-2xx so the dashboard stops; re-clicking send will re-claim & retry this chunk.
    return json({
      status: 'rejected', error: sendError,
      sent, failed, skipped: invalidSkipped, optedOut,
    }, 502);
  }

  return json({
    idempotent: false,
    sent, failed, skipped: invalidSkipped, optedOut,
    requestId,
    campaignStatus: finishResult?.status ?? null,
  });

  async function finish(
    st: string, s: number, f: number, sk: number, oo: number,
    reqId: string | null, err: string | null,
  ) {
    return await rpc<Record<string, unknown>>('finish_sms_campaign_batch', {
      p_client_campaign_id: clientCampaignId,
      p_chunk_index: chunkIndex,
      p_status: st,
      p_sent: s,
      p_failed: f,
      p_skipped: sk,
      p_opted_out: oo,
      p_request_id: reqId,
      p_error: err,
    });
  }
});
