import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// admin-api — read/write API for the self-service dashboard.
// Auth: X-Admin-Token header. All DB access is server-side with the service key.

const ADMIN_TOKEN = 'nahman-campaign-2026-x7q';

// Central DB (self-hosted Supabase on the client's server)
const SUPA_URL = 'https://db.nahmanbot.com';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODM2MjQzMjcsImV4cCI6MjA5ODk4NDMyN30.2sCfWoZlggpq9uel-e9P_OppsR6NP8xdVvbIAI0d9NM';
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

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

async function q(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toLocalPhone(phone: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('972')) return '0' + d.slice(3);
  if (d.startsWith('0')) return d;
  if (d.length === 9 && d.startsWith('5')) return '0' + d;
  return d;
}

function toIntlPhone(phone: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return '972' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '972' + d;
  return d;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  // ── campaigns: list with click + lead stats ──
  if (action === 'campaigns') {
    const rows = await q('sms_campaign_stats?select=*&order=created_at.desc&limit=50');
    return json({ campaigns: rows });
  }

  // ── leads: newest first, optional campaign filter (via click phones) ──
  if (action === 'leads') {
    const limit = Math.min(Number(body.limit) || 200, 1000);
    const offset = Number(body.offset) || 0;
    const cols = 'id,phone,name,created_at,lid_type,worker_type,how_much_loan,ezor,neches,car,hyuvim,ikul,card_type,did_hechzer,summary,hechzer_mas,is_completed,duplicate,source';
    if (body.campaign) {
      const rows = await q(`rpc/admin_campaign_leads?select=${cols}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_campaign_name: String(body.campaign),
          p_limit: limit,
          p_offset: offset,
        }),
      });
      return json({ leads: rows, total: rows.length });
    }
    let path = `leads?select=${cols}&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (body.source) path += `&source=eq.${encodeURIComponent(String(body.source))}`;
    const rows = await q(path);
    return json({ leads: rows, total: rows.length });
  }

  // ── opt-outs: list, add, or remove numbers ──
  if (action === 'opt_outs') {
    const rows = await q('sms_opt_outs?select=phone,campaign_name,source,user_agent,opted_out_at&order=opted_out_at.desc&limit=5000');
    return json({ optOuts: rows });
  }

  if (action === 'opt_out_add') {
    const intl = toIntlPhone(body.phone);
    if (!/^9725\d{8}$/.test(intl)) return json({ error: 'invalid phone' }, 400);
    await q('sms_opt_outs?on_conflict=phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ phone: intl, source: 'manual_admin' }]),
    });
    return json({ added: true, phone: intl });
  }

  if (action === 'opt_out_remove') {
    const intl = toIntlPhone(body.phone);
    await q(`sms_opt_outs?phone=eq.${intl}`, { method: 'DELETE' });
    return json({ removed: true, phone: intl });
  }

  // ── export_leads: CSV download ──
  if (action === 'export_leads') {
    const cols = ['id','phone','name','created_at','lid_type','worker_type','how_much_loan','ezor','neches','car','hyuvim','ikul','card_type','did_hechzer','summary','hechzer_mas','is_completed','duplicate','source'];
    const rows = await q(`leads?select=${cols.join(',')}&order=created_at.desc&limit=5000`);
    const csv = '\uFEFF' + [cols.join(','), ...rows.map((r: Record<string, unknown>) => cols.map(c => csvEscape(r[c])).join(','))].join('\n');
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads.csv"', ...CORS },
    });
  }

  // ══════════ GROUPS / CONTACTS ══════════

  // ── groups: list with counts ──
  if (action === 'groups') {
    const rows = await q('contact_group_counts?select=*&order=group_name');
    return json({ groups: rows });
  }

  // ── group_contacts: contacts of one group ──
  if (action === 'group_contacts') {
    const g = encodeURIComponent(String(body.group || ''));
    const rows = await q(`contacts?group_name=eq.${g}&select=id,phone,name,created_at&order=id&limit=20000`);
    return json({ contacts: rows });
  }

  // ── save_contacts: bulk upsert into a group (dedup on phone+group) ──
  if (action === 'save_contacts') {
    const group = String(body.group || '').trim();
    if (!group) return json({ error: 'missing group' }, 400);
    const input: Array<{ phone: string; name?: string }> = body.contacts || [];
    const seen = new Set<string>();
    const rows: Array<{ phone: string; name: string | null; group_name: string }> = [];
    let skipped = 0;
    for (const r of input) {
      const p = toLocalPhone(r.phone);
      if (!/^05\d{8}$/.test(p)) { skipped++; continue; }
      if (seen.has(p)) continue;
      seen.add(p);
      rows.push({ phone: p, name: (r.name || '').trim() || null, group_name: group });
    }
    let saved = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      // on_conflict targets the unique(phone, group_name) constraint — re-saving
      // an existing phone updates its name instead of erroring.
      await q('contacts?on_conflict=phone,group_name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      saved += chunk.length;
    }
    return json({ saved, skipped, group });
  }

  // ── delete_group ──
  if (action === 'delete_group') {
    const g = encodeURIComponent(String(body.group || ''));
    await q(`contacts?group_name=eq.${g}`, { method: 'DELETE' });
    return json({ deleted: true, group: body.group });
  }

  // ── delete_contact ──
  if (action === 'delete_contact') {
    await q(`contacts?id=eq.${Number(body.id)}`, { method: 'DELETE' });
    return json({ deleted: true });
  }

  return json({ error: 'unknown action' }, 400);
});
