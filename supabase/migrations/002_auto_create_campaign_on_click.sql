-- 002 — Auto-create an sms_campaigns row when a click arrives for an unknown
-- campaign (e.g. sent from Inforu's own web UI instead of the dashboard).
create or replace function public.ensure_campaign_exists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.campaign_name is not null and new.campaign_name <> '' then
    if not exists (select 1 from public.sms_campaigns where campaign_name = new.campaign_name) then
      insert into public.sms_campaigns (campaign_name, sender, sent_count, status)
      values (new.campaign_name, 'inforu-ui', 0, 'external');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sms_clicks_ensure_campaign on public.sms_clicks;
create trigger trg_sms_clicks_ensure_campaign
  before insert on public.sms_clicks
  for each row execute function public.ensure_campaign_exists();
