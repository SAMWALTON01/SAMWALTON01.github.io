import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ── send-sms-campaign — server-side Inforu sender for the serverless funnel ──
// Custom auth: X-Admin-Token header (JWT verification disabled intentionally).

const ADMIN_TOKEN = 'nahman-campaign-2026-x7q';
const INFORU_USER = 'Shimon123';
const INFORU_TOKEN = '6ace5d6b-a0f6-42e0-9382-568fdef2ba0c';
const INFORU_API = 'https://capi.inforu.co.il/api/v2/SMS/SendSms';
const FUNNEL_URL = 'https://nahmanbot.com/';
// Central DB (self-hosted Supabase on the client's server)
const SUPA_URL = 'https://db.nahmanbot.com';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODM2MjQzMjcsImV4cCI6MjA5ODk4NDMyN30.2sCfWoZlggpq9uel-e9P_OppsR6NP8xdVvbIAI0d9NM';
const DEFAULT_SENDER = 'nahman';
const BATCH = 500;
// ShortenUrlEnable DISABLED 19.7: messages with it were silently not delivered
// (feature likely not active on the Inforu account). Re-enable only after
// Inforu support confirms the shortener is live for this account.
const SHORTEN_URL = false;

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
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('972')) return '0' + d.slice(3);
  if (d.startsWith('0')) return d;
  if (d.length === 9 && d.startsWith('5')) return '0' + d;
  return d;
}

function buildLink(phone: string, name: string, campaign: string): string {
  const p = new URLSearchParams();
  p.set('p', String(phone).replace(/\D/g, ''));
  if (name) p.set('n', name);
  p.set('c', campaign);
  return `${FUNNEL_URL}?${p.toString()}`;
}

const DEFAULT_MESSAGE = [
  'שלום [#FirstName#],',
  'בדיקת זכאות מהירה — הלוואה או החזר מס, ללא התחייבות:',
  '[#Representative#]',
  'להסרה השב: הסר',
].join('\n');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const recipients: Array<{ phone: string; name?: string }> = body.recipients || [];
  const campaign = String(body.campaign || 'rehearsal_' + new Date().toISOString().slice(0, 10));
  const sender = String(body.sender || DEFAULT_SENDER);
  const dryRun = body.dryRun !== false; // default: dry run! must pass dryRun:false to send
  const message = String(body.message || DEFAULT_MESSAGE);

  const valid: Array<{ Phone: string; FirstName: string; Representative: string }> = [];
  const skipped: string[] = [];
  for (const r of recipients) {
    const phone = toLocalPhone(r.phone);
    if (!/^05\d{8}$/.test(phone)) { skipped.push(String(r.phone)); continue; }
    valid.push({ Phone: phone, FirstName: r.name || '', Representative: buildLink(r.phone, r.name || '', campaign) });
  }

  const summary: Record<string, unknown> = {
    campaign, sender, valid: valid.length, skipped, dryRun,
    sampleLink: valid[0]?.Representative || null,
  };

  if (dryRun || !valid.length) {
    return json({ ...summary, note: 'dry run — nothing sent' });
  }

  const auth = btoa(`${INFORU_USER}:${INFORU_TOKEN}`);
  let sent = 0;
  let requestId: string | null = null;
  const errors: string[] = [];

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    try {
      const res = await fetch(INFORU_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          Data: {
            Message: message,
            Recipients: batch,
            Settings: { Sender: sender, CampaignName: campaign, ShortenUrlEnable: SHORTEN_URL, AllowDuplicates: true },
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.StatusId === 1) {
        sent += data.Data?.Recipients || batch.length;
        requestId = data.RequestId || requestId;
      } else {
        errors.push(data.StatusDescription || `HTTP ${res.status}`);
      }
    } catch (e) {
      errors.push(String(e));
    }
  }

  // Record campaign in the central DB (best-effort, via REST with service key)
  try {
    if (sent > 0) {
      await fetch(`${SUPA_URL}/rest/v1/sms_campaigns`, {
        method: 'POST',
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          campaign_name: campaign, message_template: message, link_mode: 'phone',
          sender, sent_count: sent, status: 'sent', inforu_request_id: requestId,
        }),
      });
    }
  } catch (_) { /* never fail the response over bookkeeping */ }

  return json({ ...summary, dryRun: false, sent, requestId, errors });
});
