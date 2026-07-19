import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// admin-api — read/write API for the self-service dashboard.
// Auth: X-Admin-Token header. All DB access is server-side with the service key.

const ADMIN_TOKEN = 'nahman-campaign-2026-x7q';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  // ── campaigns: list with click + lead stats ──
  if (action === 'campaigns') {
    const camps = await q('sms_campaigns?select=*&order=created_at.desc&limit=50');
    const clicks = await q('sms_clicks?select=campaign_name,phone');
    const leads = await q("leads?source=eq.web_funnel&select=phone,id");
    const leadPhones = new Set(leads.map((l: { phone: string }) => l.phone));
    const byCamp: Record<string, { clicks: number; phones: Set<string> }> = {};
    for (const c of clicks) {
      const k = c.campaign_name || 'unknown';
      byCamp[k] ??= { clicks: 0, phones: new Set() };
      byCamp[k].clicks++;
      byCamp[k].phones.add(c.phone);
    }
    const out = camps.map((c: Record<string, unknown>) => {
      const s = byCamp[String(c.campaign_name)] || { clicks: 0, phones: new Set() };
      let leadsCount = 0;
      for (const p of s.phones) if (leadPhones.has(p)) leadsCount++;
      return { ...c, clicks: s.clicks, unique_clickers: s.phones.size, leads: leadsCount };
    });
    return json({ campaigns: out });
  }

  // ── leads: newest first, optional campaign filter (via click phones) ──
  if (action === 'leads') {
    const limit = Math.min(Number(body.limit) || 200, 1000);
    const offset = Number(body.offset) || 0;
    let phones: string[] | null = null;
    if (body.campaign) {
      const cl = await q(`sms_clicks?campaign_name=eq.${encodeURIComponent(String(body.campaign))}&select=phone`);
      phones = [...new Set(cl.map((c: { phone: string }) => c.phone))];
      if (!phones.length) return json({ leads: [], total: 0 });
    }
    const cols = 'id,phone,name,created_at,lid_type,worker_type,how_much_loan,ezor,neches,car,hyuvim,ikul,card_type,did_hechzer,summary,hechzer_mas,is_completed,duplicate,source';
    let path = `leads?select=${cols}&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (phones) path += `&phone=in.(${phones.slice(0, 500).join(',')})`;
    if (body.source) path += `&source=eq.${encodeURIComponent(String(body.source))}`;
    const rows = await q(path);
    return json({ leads: rows, total: rows.length });
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
