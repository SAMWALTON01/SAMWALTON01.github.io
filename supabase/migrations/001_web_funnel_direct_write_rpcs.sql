-- 001 — Web-funnel direct-write RPCs (security definer).
-- The browser holds only the anon key and calls these functions;
-- no table-level anon access is granted at all.

-- Click logger
create or replace function public.log_web_click(
  p_phone text,
  p_name text default null,
  p_campaign text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_phone like '0%' then v_phone := '972' || substr(v_phone, 2); end if;
  if v_phone !~ '^972\d{8,9}$' then return; end if;
  insert into public.sms_clicks (campaign_name, phone, user_agent, clicked_at)
  values (
    coalesce(nullif(left(trim(coalesce(p_campaign, '')), 200), ''), 'web_funnel'),
    v_phone,
    left(coalesce(p_user_agent, ''), 500),
    now()
  );
end;
$$;

-- Summary calculator (port of the bot's classifier logic, web-adapted)
create or replace function public.calc_summary_web(l public.leads)
returns text
language plpgsql
stable
as $$
declare
  lidtype text := trim(coalesce(l.lid_type, ''));
  main text := '';
  tax text := '';
  sh text := trim(coalesce(l.shne_neches, ''));
  car text := trim(coalesce(l.car, ''));
  hy text := trim(coalesce(l.hyuvim, ''));
  ik text := trim(coalesce(l.ikul, ''));
  ct text := trim(coalesce(l.card_type, ''));
  yp text := trim(coalesce(l.yesh_pensia, ''));
  lm text := trim(coalesce(l.lim_shoch, ''));
  ip text := trim(coalesce(l.ikul_pension, ''));
  chack text := trim(coalesce(l.chack_hechzer, ''));
  did text := trim(coalesce(l.did_hechzer, ''));
  hasChaz boolean;
  hasIk boolean;
begin
  if lidtype = 'הלוואה' then
    if position('לא רוצה לשעבד' in sh) > 0 then
      main := 'סיים תהליך נכס לא רוצה לשעבד';
    elsif position('רוצה לשעבד' in sh) > 0 and trim(coalesce(l.neches_value, '')) <> '' then
      main := 'סיים תהליך נכס רוצה לשעבד';
    elsif position('רוצה לשעבד' in sh) > 0 then
      main := 'נכס רוצה לשעבד - בתהליך';
    elsif position('יש לי רכב' in car) > 0 then
      hasChaz := position('חזרו לי חיובים' in hy) > 0 and position('לא חזרו' in hy) = 0;
      hasIk := (position('יש לי עיקול' in ik) > 0 or position('כן' in ik) > 0)
               and position('לא' in ik) = 0 and position('אין' in ik) = 0;
      if hasChaz or hasIk then main := 'סיים תהליך רכב יש עיקול או חזרות';
      elsif ct = 'כרטיס אשראי' then main := 'סיים תהליך רכב אשראי';
      elsif ct = 'כרטיס דיירקט' then main := 'סיים תהליך רכב דיירקט';
      elsif hy <> '' and ik <> '' then main := 'רכב ללא חזרות/עיקול - ממתין לכרטיס';
      else main := 'רכב - בתהליך';
      end if;
    elsif position('אין לי רכב' in car) > 0 then
      main := 'סיים תהליך הלוואה לכל מטרה';
    elsif trim(coalesce(l.neches,'')) <> '' or trim(coalesce(l.ezor,'')) <> ''
       or trim(coalesce(l.worker_type,'')) <> '' or trim(coalesce(l.how_much_loan,'')) <> ''
       or trim(coalesce(l.name,'')) <> '' then
      main := 'הלוואה - בתהליך';
    end if;
  elsif lidtype = 'משיכה' then
    if position('אין לי פנסיה' in yp) > 0 then
      main := 'סיים תהליך משיכה אין פנסיה';
    elsif position('לא רוצה למשוך' in lm) > 0 then
      main := 'סיים תהליך משיכה לא רוצה למשוך';
    elsif position('רוצה למשוך' in lm) > 0 then
      if position('יש לי עיקול' in ip) > 0 then main := 'סיים תהליך משיכה יש עיקול';
      elsif position('אין לי עיקול' in ip) > 0 then main := 'סיים תהליך משיכה אין עיקול';
      else main := 'משיכה רוצה למשוך - בתהליך';
      end if;
    elsif trim(coalesce(l.how_much_pensia,'')) <> '' or trim(coalesce(l.worker_type,'')) <> ''
       or trim(coalesce(l.name,'')) <> '' then
      main := 'משיכה - בתהליך';
    end if;
  end if;

  if position('אל תבדקו' in chack) > 0 or did like 'לא%' then
    tax := 'החזר מס לא מעוניין';
  elsif position('תבדקו' in chack) > 0 or position('אשמח' in did) > 0 then
    if trim(coalesce(l.working_time,'')) <> '' and trim(coalesce(l.income,'')) <> '' then
      tax := 'החזר מס סיים תהליך';
    else
      tax := 'החזר מס בתהליך';
    end if;
  end if;

  if main <> '' and tax <> '' then return main || ' + ' || tax; end if;
  if main <> '' then return main; end if;
  return tax;
end;
$$;

-- Lead submit: get-or-create with 24h dedup, field whitelist, derived fields
create or replace function public.submit_web_lead(
  p_phone text,
  p_name text default null,
  p_fields jsonb default '{}'::jsonb,
  p_flow_path jsonb default '[]'::jsonb,
  p_completed boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_lead public.leads%rowtype;
  v_id bigint;
  v_now timestamptz := now();
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_hechzer boolean;
  v_name text;
  v_path text[];
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_phone like '0%' then v_phone := '972' || substr(v_phone, 2); end if;
  if v_phone !~ '^972\d{8,9}$' then
    raise exception 'invalid phone';
  end if;
  v_name := nullif(left(trim(coalesce(p_name, f->>'name', '')), 200), '');
  select array_agg(x) into v_path from jsonb_array_elements_text(coalesce(p_flow_path, '[]'::jsonb)) x;

  select * into v_lead from public.leads
   where phone = v_phone order by created_at desc limit 1;

  if found and v_lead.created_at > v_now - interval '24 hours' then
    v_id := v_lead.id;
    update public.leads set
      lid_type       = coalesce(nullif(left(trim(f->>'lid_type'),500),''),       lid_type),
      worker_type    = coalesce(nullif(left(trim(f->>'worker_type'),500),''),    worker_type),
      how_much_loan  = coalesce(nullif(left(trim(f->>'how_much_loan'),500),''),  how_much_loan),
      ezor           = coalesce(nullif(left(trim(f->>'ezor'),500),''),           ezor),
      neches         = coalesce(nullif(left(trim(f->>'neches'),500),''),         neches),
      shne_neches    = coalesce(nullif(left(trim(f->>'shne_neches'),500),''),    shne_neches),
      mortgage       = coalesce(nullif(left(trim(f->>'mortgage'),500),''),       mortgage),
      neches_value   = coalesce(nullif(left(trim(f->>'neches_value'),500),''),   neches_value),
      car            = coalesce(nullif(left(trim(f->>'car'),500),''),            car),
      hyuvim         = coalesce(nullif(left(trim(f->>'hyuvim'),500),''),         hyuvim),
      ikul           = coalesce(nullif(left(trim(f->>'ikul'),500),''),           ikul),
      card_type      = coalesce(nullif(left(trim(f->>'card_type'),500),''),      card_type),
      how_much_pensia= coalesce(nullif(left(trim(f->>'how_much_pensia'),500),''),how_much_pensia),
      yesh_pensia    = coalesce(nullif(left(trim(f->>'yesh_pensia'),500),''),    yesh_pensia),
      lim_shoch      = coalesce(nullif(left(trim(f->>'lim_shoch'),500),''),      lim_shoch),
      ikul_pension   = coalesce(nullif(left(trim(f->>'ikul_pension'),500),''),   ikul_pension),
      chack_hechzer  = coalesce(nullif(left(trim(f->>'chack_hechzer'),500),''),  chack_hechzer),
      working_time   = coalesce(nullif(left(trim(f->>'working_time'),500),''),   working_time),
      did_hechzer    = coalesce(nullif(left(trim(f->>'did_hechzer'),500),''),    did_hechzer),
      income         = coalesce(nullif(left(trim(f->>'income'),500),''),         income),
      remarks        = coalesce(nullif(left(trim(f->>'remarks'),2000),''),       remarks),
      name           = coalesce(v_name, name),
      source         = 'web_funnel',
      source_session = 'web_funnel',
      flow_path      = coalesce(v_path, flow_path),
      is_completed   = p_completed or is_completed,
      last_activity  = v_now,
      updated_at     = v_now
    where id = v_id
    returning * into v_lead;
  else
    insert into public.leads (
      phone, datetime, last_activity, session_key, status, current_step,
      duplicate, source, source_session,
      lid_type, worker_type, how_much_loan, ezor, neches, shne_neches, mortgage,
      neches_value, car, hyuvim, ikul, card_type, how_much_pensia, yesh_pensia,
      lim_shoch, ikul_pension, chack_hechzer, working_time, did_hechzer, income,
      remarks, name, flow_path, is_completed, created_at, updated_at
    ) values (
      v_phone, v_now, v_now, v_phone || '_' || v_now, 'new', null,
      case when found then 'כפול' else 'יחיד' end, 'web_funnel', 'web_funnel',
      nullif(left(trim(f->>'lid_type'),500),''), nullif(left(trim(f->>'worker_type'),500),''),
      nullif(left(trim(f->>'how_much_loan'),500),''), nullif(left(trim(f->>'ezor'),500),''),
      nullif(left(trim(f->>'neches'),500),''), nullif(left(trim(f->>'shne_neches'),500),''),
      nullif(left(trim(f->>'mortgage'),500),''), nullif(left(trim(f->>'neches_value'),500),''),
      nullif(left(trim(f->>'car'),500),''), nullif(left(trim(f->>'hyuvim'),500),''),
      nullif(left(trim(f->>'ikul'),500),''), nullif(left(trim(f->>'card_type'),500),''),
      nullif(left(trim(f->>'how_much_pensia'),500),''), nullif(left(trim(f->>'yesh_pensia'),500),''),
      nullif(left(trim(f->>'lim_shoch'),500),''), nullif(left(trim(f->>'ikul_pension'),500),''),
      nullif(left(trim(f->>'chack_hechzer'),500),''), nullif(left(trim(f->>'working_time'),500),''),
      nullif(left(trim(f->>'did_hechzer'),500),''), nullif(left(trim(f->>'income'),500),''),
      nullif(left(trim(f->>'remarks'),2000),''), v_name,
      coalesce(v_path, '{}'::text[]), p_completed, v_now, v_now
    ) returning * into v_lead;
    v_id := v_lead.id;
  end if;

  v_hechzer := (position('תבדקו' in coalesce(v_lead.chack_hechzer,'')) > 0
                and position('אל תבדקו' in coalesce(v_lead.chack_hechzer,'')) = 0)
               or position('אשמח' in coalesce(v_lead.did_hechzer,'')) > 0;
  update public.leads
     set summary = public.calc_summary_web(v_lead),
         hechzer_mas = v_hechzer,
         updated_at = v_now
   where id = v_id;

  return v_id;
end;
$$;

grant execute on function public.log_web_click(text, text, text, text) to anon, authenticated;
grant execute on function public.submit_web_lead(text, text, jsonb, jsonb, boolean) to anon, authenticated;
