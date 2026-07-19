-- 003_contacts_groups.sql
-- Reusable contact groups: upload once, reuse in every campaign.
-- Access pattern: table is RLS-locked (no public access). All reads/writes go
-- through the admin-api edge function (service key). One contact can appear in
-- multiple groups; re-saving the same phone in the same group updates the name.

create table if not exists public.contacts (
  id bigint generated always as identity primary key,
  phone text not null,
  name text,
  group_name text not null,
  created_at timestamptz not null default now(),
  unique (phone, group_name)
);

create index if not exists contacts_group_name_idx on public.contacts (group_name);

alter table public.contacts enable row level security;

-- No policies = no access for anon/authenticated. Service role bypasses RLS.

-- Per-group counts for the dashboard list view.
create or replace view public.contact_group_counts as
select
  group_name,
  count(*)::int as contacts_count,
  max(created_at) as last_updated
from public.contacts
group by group_name
order by group_name;
