import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// inforu-probe — check Inforu connectivity + which sender IDs are allowed.
// Custom auth: X-Admin-Token header.

const ADMIN_TOKEN = 'nahman-campaign-2026-x7q';
const INFORU_USER = 'Shimon123';
const INFORU_TOKEN = '6ace5d6b-a0f6-42e0-9382-568fdef2ba0c';
const BASE = 'https://capi.inforu.co.il/api/v2/SMS/Whitelist/SenderIdIsAllowed';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-token, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS });
  }
  const body = await req.json().catch(() => ({}));
  const candidates: string[] = body.candidates || ['nahman', 'Nahman', 'NAHMAN', 'nachman', 'Nachman', 'נחמן'];
  const auth = btoa(`${INFORU_USER}:${INFORU_TOKEN}`);
  const results: Record<string, unknown> = {};
  let reachable = true;

  for (const s of candidates) {
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({ Data: { SenderId: s } }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      results[s] = data?.Data?.IsAllowed ?? data?.StatusDescription ?? `HTTP ${res.status}`;
    } catch (e) {
      results[s] = `unreachable: ${e}`;
      reachable = false;
    }
  }

  return Response.json({ reachable, user: INFORU_USER, results }, { headers: CORS });
});
