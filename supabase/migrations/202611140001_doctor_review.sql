begin;
create schema if not exists everwell_private;
revoke all on schema everwell_private from public, anon, authenticated;
grant usage on schema everwell_private to authenticated;

-- Provisioned only by a trusted operator after registration/identity verification.
create table public.clinical_reviewers (
  user_id uuid primary key references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 120),
  registration_number text not null check (char_length(registration_number) between 1 and 80),
  verified_at timestamptz not null,
  active boolean not null default false
);
create table public.clinical_assignments (
  patient_id uuid not null references auth.users(id),
  doctor_id uuid not null references public.clinical_reviewers(user_id),
  primary key(patient_id,doctor_id), check(patient_id<>doctor_id)
);
create function everwell_private.can_review(patient uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.clinical_assignments a join public.clinical_reviewers d on d.user_id=a.doctor_id
    where a.patient_id=patient and a.doctor_id=auth.uid() and d.active and d.verified_at is not null and a.patient_id<>auth.uid());
$$;
revoke all on function everwell_private.can_review(uuid) from public, anon;
grant execute on function everwell_private.can_review(uuid) to authenticated;

create function everwell_private.valid_measurements(data jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare r jsonb; k text; lo numeric; hi numeric; dt date;
begin
  if jsonb_typeof(data)<>'array' or jsonb_array_length(data) not between 1 and 100 then return false; end if;
  for r in select value from jsonb_array_elements(data) loop
    if jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>6
      or not (r ?& array['code','unit','collected_on','value','reference_low','reference_high']) then return false; end if;
    if not ((r->>'code'='ferritin' and r->>'unit'='ug/L')
      or (r->>'code'='vitamin_d' and r->>'unit'='nmol/L')
      or (r->>'code'='hba1c' and r->>'unit' in ('%','mmol/mol'))
      or (r->>'code'='haemoglobin' and r->>'unit'='g/L')
      or (r->>'code'='ldl' and r->>'unit'='mmol/L')
      or (r->>'code'='tsh' and r->>'unit'='mIU/L')) then return false; end if;
    if r->>'code' is null or r->>'unit' is null or r->>'collected_on' is null then return false; end if;
    if (r->>'collected_on') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    dt:=(r->>'collected_on')::date;
    if to_char(dt,'YYYY-MM-DD')<>r->>'collected_on' then return false; end if;
    if jsonb_typeof(r->'value')<>'number' or (r->>'value')::numeric not between 0 and 1000000000 then return false; end if;
    for k in select unnest(array['reference_low','reference_high']) loop
      if jsonb_typeof(r->k) not in ('number','null') then return false; end if;
      if jsonb_typeof(r->k)='number' and (r->>k)::numeric not between 0 and 1000000000 then return false; end if;
    end loop;
    if (jsonb_typeof(r->'reference_low')='null')<>(jsonb_typeof(r->'reference_high')='null') then return false; end if;
    if jsonb_typeof(r->'reference_low')='number' and (r->>'reference_low')::numeric>(r->>'reference_high')::numeric then return false; end if;
  end loop;
  return not exists(select 1 from jsonb_array_elements(data) x group by x->>'code',x->>'unit',x->>'collected_on' having count(*)>1);
exception when others then return false;
end;
$$;
revoke all on function everwell_private.valid_measurements(jsonb) from public,anon,authenticated;

create table public.lab_reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  processing_consent_at timestamptz not null default now(),
  consent_version text not null default 'openai-draft-v1',
  measurements jsonb not null check (everwell_private.valid_measurements(measurements)),
  status text not null default 'received' check(status in ('received','processing','needs_review','approved','rejected','failed')),
  attempt integer not null default 0 check(attempt between 0 and 3),
  processing_at timestamptz,
  failure_code text,
  review_note text check(char_length(review_note)<=4000),
  reviewed_at timestamptz
);
create index lab_reports_owner_time on public.lab_reports(patient_id,submitted_at desc);
create table public.blood_analysis_drafts (
  report_id uuid primary key references public.lab_reports(id),
  analysis_version integer not null,
  narrative jsonb not null,
  graph_data jsonb not null,
  model text not null,
  prompt_version text not null,
  provider_response_id text,
  generated_at timestamptz not null default now()
);
create table public.blood_analysis_releases (
  report_id uuid primary key references public.lab_reports(id),
  patient_id uuid not null references auth.users(id),
  analysis_version integer not null,
  summary text not null,
  graph_data jsonb not null,
  approved_by uuid not null references public.clinical_reviewers(user_id),
  reviewer_name text not null,
  approved_at timestamptz not null default now()
);
create table public.clinical_audit_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.lab_reports(id),
  event text not null,
  actor_id uuid,
  analysis_version integer,
  recorded_at timestamptz not null default now()
);

alter table public.clinical_reviewers enable row level security;
alter table public.clinical_assignments enable row level security;
alter table public.lab_reports enable row level security;
alter table public.blood_analysis_drafts enable row level security;
alter table public.blood_analysis_releases enable row level security;
alter table public.clinical_audit_events enable row level security;
revoke all on public.clinical_reviewers,public.clinical_assignments,public.lab_reports,public.blood_analysis_drafts,public.blood_analysis_releases,public.clinical_audit_events from public,anon,authenticated;
grant select on public.clinical_reviewers,public.clinical_assignments,public.lab_reports,public.blood_analysis_drafts,public.blood_analysis_releases,public.clinical_audit_events to authenticated;
-- No browser INSERT/UPDATE/DELETE grants on any clinical table.
grant all on public.clinical_reviewers,public.clinical_assignments,public.lab_reports,public.blood_analysis_drafts,public.blood_analysis_releases,public.clinical_audit_events to service_role;
grant usage,select on sequence public.clinical_audit_events_id_seq to service_role;
create policy reviewer_self on public.clinical_reviewers for select to authenticated using(user_id=(select auth.uid()));
create policy assignments_self on public.clinical_assignments for select to authenticated using(patient_id=(select auth.uid()) or doctor_id=(select auth.uid()));
create policy report_read on public.lab_reports for select to authenticated using(patient_id=(select auth.uid()) or everwell_private.can_review(patient_id));
create policy draft_doctor_only on public.blood_analysis_drafts for select to authenticated using(exists(select 1 from public.lab_reports r where r.id=report_id and everwell_private.can_review(r.patient_id)));
create policy approved_release_only on public.blood_analysis_releases for select to authenticated using(
  (patient_id=(select auth.uid()) or everwell_private.can_review(patient_id))
  and exists(select 1 from public.lab_reports r where r.id=report_id and r.status='approved'));
create policy audit_doctor_only on public.clinical_audit_events for select to authenticated using(exists(select 1 from public.lab_reports r where r.id=report_id and everwell_private.can_review(r.patient_id)));

create function public.submit_lab_report(report_id uuid, result_rows jsonb, consent_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); existing public.lab_reports;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if consent_confirmed is distinct from true then raise exception 'Processing consent required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
  select * into existing from public.lab_reports where id=report_id;
  if found then
    if existing.patient_id<>owner or existing.measurements<>result_rows then raise exception 'Report identity conflict' using errcode='42501'; end if;
    return report_id;
  end if;
  if not exists(select 1 from public.clinical_assignments a join public.clinical_reviewers d on d.user_id=a.doctor_id where a.patient_id=owner and d.active and d.verified_at is not null and a.doctor_id<>owner) then
    raise exception 'A verified reviewing doctor must be assigned first' using errcode='42501';
  end if;
  if (select count(*) from public.lab_reports where patient_id=owner and submitted_at>now()-interval '24 hours')>=5 then raise exception 'Daily report limit reached'; end if;
  if not everwell_private.valid_measurements(result_rows) then raise exception 'Invalid structured measurements'; end if;
  if exists(select 1 from jsonb_array_elements(result_rows) r where (r->>'collected_on')::date>(now() at time zone 'Australia/Sydney')::date) then raise exception 'Future collection date'; end if;
  insert into public.lab_reports(id,patient_id,measurements) values(report_id,owner,result_rows);
  insert into public.clinical_audit_events(report_id,event,actor_id) values(report_id,'submitted',owner);
  return report_id;
end;
$$;
revoke all on function public.submit_lab_report(uuid,jsonb,boolean) from public,anon;
grant execute on function public.submit_lab_report(uuid,jsonb,boolean) to authenticated;

-- Worker-only functions. The worker never approves or publishes a result.
create function public.claim_blood_analysis(report_id uuid)
returns setof public.lab_reports language plpgsql security definer set search_path='' as $$
declare r public.lab_reports;
begin
  update public.lab_reports set status='processing',attempt=attempt+1,processing_at=now(),failure_code=null
    where id=report_id and attempt<3 and (status in ('received','failed') or (status='processing' and processing_at<now()-interval '15 minutes')) returning * into r;
  if found then
    insert into public.clinical_audit_events(report_id,event,analysis_version) values(report_id,'analysis_started',r.attempt);
    return next r;
  end if;
end;
$$;
create function public.finish_blood_analysis(report_id uuid, expected_attempt integer, draft jsonb, charts jsonb, model_name text, prompt_id text, response_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.lab_reports;
begin
  select * into r from public.lab_reports where id=report_id for update;
  if r.status<>'processing' or r.attempt<>expected_attempt then return false; end if;
  if jsonb_typeof(draft)<>'object' or jsonb_typeof(charts)<>'array' then raise exception 'Invalid worker output'; end if;
  insert into public.blood_analysis_drafts(report_id,analysis_version,narrative,graph_data,model,prompt_version,provider_response_id)
    values(report_id,expected_attempt,draft,charts,model_name,prompt_id,response_id);
  update public.lab_reports set status='needs_review' where id=report_id;
  insert into public.clinical_audit_events(report_id,event,analysis_version) values(report_id,'draft_created',expected_attempt);
  return true;
end;
$$;
create function public.fail_blood_analysis(report_id uuid, expected_attempt integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.lab_reports set status='failed',failure_code='generation_failed' where id=report_id and status='processing' and attempt=expected_attempt;
  if found then insert into public.clinical_audit_events(report_id,event,analysis_version) values(report_id,'analysis_failed',expected_attempt); end if;
end;
$$;
revoke all on function public.claim_blood_analysis(uuid),public.finish_blood_analysis(uuid,integer,jsonb,jsonb,text,text,text),public.fail_blood_analysis(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_blood_analysis(uuid),public.finish_blood_analysis(uuid,integer,jsonb,jsonb,text,text,text),public.fail_blood_analysis(uuid,integer) to service_role;

create function public.review_blood_analysis(report_id uuid, expected_version integer, decision text, edited_summary text, doctor_note text, source_verified boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.lab_reports; d public.blood_analysis_drafts; reviewer public.clinical_reviewers;
begin
  select * into r from public.lab_reports where id=report_id for update;
  if not found or not everwell_private.can_review(r.patient_id) then raise exception 'Assigned verified doctor required' using errcode='42501'; end if;
  select * into d from public.blood_analysis_drafts where blood_analysis_drafts.report_id=review_blood_analysis.report_id;
  if r.status<>'needs_review' or d.analysis_version is distinct from expected_version then raise exception 'Review version conflict'; end if;
  if decision not in ('approve','reject') or decision is null then raise exception 'Invalid review decision'; end if;
  if doctor_note is null or char_length(btrim(doctor_note)) not between 1 and 4000 then raise exception 'Doctor review note required'; end if;
  if decision='approve' then
    if source_verified is distinct from true or edited_summary is null or char_length(btrim(edited_summary)) not between 1 and 4000 then raise exception 'Verify source and provide final explanation'; end if;
    select * into reviewer from public.clinical_reviewers where user_id=auth.uid();
    insert into public.blood_analysis_releases(report_id,patient_id,analysis_version,summary,graph_data,approved_by,reviewer_name)
      values(r.id,r.patient_id,d.analysis_version,edited_summary,d.graph_data,auth.uid(),reviewer.display_name);
  end if;
  update public.lab_reports set status=case decision when 'approve' then 'approved' else 'rejected' end,review_note=doctor_note,reviewed_at=now() where id=r.id;
  insert into public.clinical_audit_events(report_id,event,actor_id,analysis_version) values(r.id,case decision when 'approve' then 'approved' else 'rejected' end,auth.uid(),d.analysis_version);
end;
$$;
revoke all on function public.review_blood_analysis(uuid,integer,text,text,text,boolean) from public,anon;
grant execute on function public.review_blood_analysis(uuid,integer,text,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
