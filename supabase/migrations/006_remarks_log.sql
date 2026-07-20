-- 006_remarks_log.sql — הודעות לקוח נשמרות להערות (20.7, בקשת הלקוח)
-- remarks הופך מדריסה לצבירה: כל הודעה מתווספת עם חותמת זמן בפורמט הבוט
-- [HH:MM:SS ,D.M.YYYY]; הודעה ראשונה מסומנת "הודעת פתיחה:". אדיטיבי, create or replace.
begin;

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
  v_ts text := '[' || to_char(v_now at time zone 'Asia/Jerusalem', 'HH24:MI:SS ,FMDD.FMMM.YYYY') || '] ';
  v_ts_open text := '[' || to_char(v_now at time zone 'Asia/Jerusalem', 'HH24:MI:SS ,FMDD.FMMM.YYYY') || '] הודעת פתיחה: ';
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
      has_insurance  = coalesce(nullif(left(trim(f->>'has_insurance'),500),''),  has_insurance),
      remarks        = case
                         when nullif(trim(f->>'remarks'),'') is not null then
                           left(case when nullif(remarks,'') is null
                                then v_ts_open || trim(f->>'remarks')
                                else remarks || ' ' || v_ts || trim(f->>'remarks')
                                end, 2000)
                         else remarks end,
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
      has_insurance, remarks, name, flow_path, is_completed, created_at, updated_at
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
      nullif(left(trim(f->>'has_insurance'),500),''),
      case when nullif(trim(f->>'remarks'),'') is not null
           then left(v_ts_open || trim(f->>'remarks'), 2000) else null end, v_name,
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


commit;
