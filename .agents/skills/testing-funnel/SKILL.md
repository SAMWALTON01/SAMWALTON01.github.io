---
name: testing-funnel
description: Test the SMS funnel (index.html) and the campaign DB layer end-to-end without touching the live production DB. Use when verifying funnel flow, branding, opt-out, short-link tokens, or migration 007 RPCs.
---

# Testing the funnel & campaign system

## Key facts
- `index.html` is a static WhatsApp-style funnel. The bot script is a **hardcoded `FLOW` object** in the page, so the client-visible flow renders fully client-side; the DB is only used for writes (`submit_web_lead`, `log_web_click`), short-link resolution (`resolve_sms_short_link`), and opt-out (`opt_out_sms` / `opt_out_sms_by_phone`).
- Production points at the live self-hosted Supabase `https://db.nahmanbot.com` (const `SUPABASE_URL`). **Do NOT run the funnel against it for testing** — every answer writes a partial lead into the real 13K-lead `leads` table.
- Boot logic (`index.html` BOOT section): with no `?token`/`?p=` in the URL it shows a phone gate first, then the opening menu. An opted-out number, on reload, shows "המספר כבר הוסר..." and does not re-ask the menu.

## Safe local demo (no live DB)
Serve a copy of `index.html` with `SUPABASE_URL` pointed to a same-origin mock that returns `{ok:true}` for the RPCs. This keeps the real flow but sends nothing to production.

1. Copy `index.html` to a scratch dir and set `const SUPABASE_URL = '';` (same-origin).
2. Run a tiny Node http server that (a) serves that `index.html` on GET, and (b) answers `POST /rest/v1/rpc/<fn>` with JSON. Handle `OPTIONS` (CORS preflight) with 204. Useful mock returns:
   - `resolve_sms_short_link` → `{ok:true, phone:'972501112233', name:'...', campaign:'demo', optedOut:false}`
   - `opt_out_sms` / `opt_out_sms_by_phone` / `submit_web_lead` / `log_web_click` → `{ok:true}`
3. Open `http://localhost:<port>/`, walk the flow, and `tail` the server log to assert which RPCs fired with what payload (e.g. phone normalized to `9725XXXXXXXX`).

### Gotchas
- **Hebrew text typing via the computer tool may not register** in inputs. Latin text (e.g. a name like `David Cohen`) works and is fine for progressing `type:'text'` steps where content doesn't matter. Phone digits type fine.
- Name step requires length >= 2 or it toasts "נא להזין תשובה".
- To restart from the opening menu (e.g. for the opt-out test), clear `localStorage` (key `nahman_funnel_v4`) and reload.
- A loan path that reaches the tax-refund follow-up quickly: הלוואה → אני שכיר → any amount → name → מרכז → לא אין לי נכס → אין לי רכב → כן חזרו לי חיובים → tax_return_offer.

## Validating migration 007 RPCs (no live DB)
`psql`/`postgres` aren't installed but **docker is**. Spin up throwaway Postgres 15, create prerequisite base tables/roles, apply `supabase/migrations/007_short_links_opt_outs.sql`, then run the psql test scripts (the previous agent's `test_short_links_opt_outs.sql`, `test_10k_campaign.sql`). They use `\set ON_ERROR_STOP on` and raise on failure. The 007 SQL uses `set role anon` and grants, so create NOLOGIN roles `anon`, `authenticated`, `service_role` first. The 10K test expects 9750 tokens after 250 opt-outs out of 10000.

## Type-checking edge functions
Edge functions are Deno TS. Install Deno (`curl -fsSL https://deno.land/install.sh | sh`) and run `deno check supabase/functions/*/index.ts`.

## Devin Secrets Needed
None for local testing (mock DB). Real end-to-end against production would need the live Supabase service/anon keys and the Inforu SMS credentials, which are currently hard-coded in the source — do not exercise those in tests.
