-- Run as administrator in a TEST project after both migrations. Rolls back all fixtures.
begin;
select set_config('everwell.patient',gen_random_uuid()::text,true);
select set_config('everwell.other',gen_random_uuid()::text,true);
select set_config('everwell.doctor',gen_random_uuid()::text,true);
select set_config('everwell.unverified',gen_random_uuid()::text,true);
select set_config('everwell.report',gen_random_uuid()::text,true);
select set_config('everwell.rejected',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('everwell.patient')::uuid),(current_setting('everwell.other')::uuid),(current_setting('everwell.doctor')::uuid),(current_setting('everwell.unverified')::uuid);
insert into public.clinical_reviewers(user_id,display_name,registration_number,verified_at,active) values
  (current_setting('everwell.doctor')::uuid,'Verified test doctor','TEST-ONLY-NOT-REGISTRATION',now(),true),
  (current_setting('everwell.unverified')::uuid,'Inactive test doctor','TEST-ONLY-NOT-REGISTRATION',now(),false);
insert into public.clinical_assignments(patient_id,doctor_id) values
  (current_setting('everwell.patient')::uuid,current_setting('everwell.doctor')::uuid),
  (current_setting('everwell.patient')::uuid,current_setting('everwell.unverified')::uuid);
-- Self-review cannot be assigned.
do $$ begin
  begin
    insert into public.clinical_assignments values(current_setting('everwell.doctor')::uuid,current_setting('everwell.doctor')::uuid);
    raise exception 'FAIL: self-assignment accepted';
  exception when check_violation then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('everwell.patient'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.patient'),'role','authenticated')::text,true);
select public.submit_lab_report(current_setting('everwell.report')::uuid,'[{"code":"ferritin","unit":"ug/L","collected_on":"2026-09-01","value":18,"reference_low":30,"reference_high":150}]'::jsonb,true);
select public.submit_lab_report(current_setting('everwell.rejected')::uuid,'[{"code":"ferritin","unit":"ug/L","collected_on":"2026-09-01","value":19,"reference_low":30,"reference_high":150}]'::jsonb,true);
do $$ begin
  begin
    update public.lab_reports set status='approved';raise exception 'FAIL: patient updated approval status';
  exception when insufficient_privilege then null;end;
  begin
    update public.clinical_reviewers set active=true;raise exception 'FAIL: patient promoted a reviewer';
  exception when insufficient_privilege then null;end;
  begin
    perform public.claim_blood_analysis(current_setting('everwell.report')::uuid);raise exception 'FAIL: patient invoked privileged worker';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Simulate worker output. Only the worker's privileged database role can call these RPCs.
select * from public.claim_blood_analysis(current_setting('everwell.report')::uuid);
select public.finish_blood_analysis(current_setting('everwell.report')::uuid,1,'{"summary":"PRIVATE AI TEXT","observations":[],"limitations":["Test only"]}',
  '[{"code":"ferritin","label":"Ferritin","unit":"ug/L","points":[{"date":"2026-09-01","value":18,"low":30,"high":150,"interval_status":"below"}]}]','test-model','test-prompt','test-response');
select * from public.claim_blood_analysis(current_setting('everwell.rejected')::uuid);
select public.finish_blood_analysis(current_setting('everwell.rejected')::uuid,1,'{"summary":"PRIVATE REJECTED AI TEXT","observations":[],"limitations":["Test only"]}','[]','test-model','test-prompt','test-response');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('everwell.patient'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.patient'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.blood_analysis_drafts)<>0 then raise exception 'FAIL: patient read draft';end if;
  if (select count(*) from public.blood_analysis_releases)<>0 then raise exception 'FAIL: unapproved content visible';end if;
  begin
    perform public.review_blood_analysis(current_setting('everwell.report')::uuid,1,'approve','Forged approval','Forged note',true);
    raise exception 'FAIL: patient self-approved';
  exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('everwell.other'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.other'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.lab_reports)<>0 then raise exception 'FAIL: other patient read source reports';end if;
  if (select count(*) from public.blood_analysis_drafts)<>0 then raise exception 'FAIL: other patient read drafts';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('everwell.unverified'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.unverified'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.blood_analysis_drafts)<>0 then raise exception 'FAIL: inactive doctor read draft';end if;
  begin
    perform public.review_blood_analysis(current_setting('everwell.report')::uuid,1,'approve','Inactive approval','Note',true);
    raise exception 'FAIL: inactive doctor approved';
  exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('everwell.doctor'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.doctor'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.blood_analysis_drafts)<>2 then raise exception 'FAIL: assigned doctor cannot see drafts';end if;
  begin
    perform public.review_blood_analysis(current_setting('everwell.report')::uuid,999,'approve','Wrong version','Note',true);
    raise exception 'FAIL: stale version approved';
  exception when raise_exception then if sqlerrm<>'Review version conflict' then raise;end if;end;
  begin
    perform public.review_blood_analysis(current_setting('everwell.report')::uuid,1,'approve','No source check','Note',false);
    raise exception 'FAIL: unchecked source approved';
  exception when raise_exception then if sqlerrm<>'Verify source and provide final explanation' then raise;end if;end;
end $$;
select public.review_blood_analysis(current_setting('everwell.report')::uuid,1,'approve','DOCTOR EDITED FINAL','Source and context verified',true);
select public.review_blood_analysis(current_setting('everwell.rejected')::uuid,1,'reject',null,'Correct the source before resubmitting',false);
-- Revocation removes a doctor's access, even if the browser still shows the queue.
reset role;
update public.clinical_reviewers set active=false where user_id=current_setting('everwell.doctor')::uuid;
set local role authenticated;
do $$ begin
  if (select count(*) from public.blood_analysis_drafts)<>0 then raise exception 'FAIL: revoked doctor still reads drafts';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('everwell.patient'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.patient'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.blood_analysis_releases)<>1 then raise exception 'FAIL: release/rejection boundary failed';end if;
  if (select summary from public.blood_analysis_releases limit 1)<>'DOCTOR EDITED FINAL' then raise exception 'FAIL: AI text released instead of doctor text';end if;
  if (select count(*) from public.blood_analysis_drafts)<>0 then raise exception 'FAIL: approval exposed draft table';end if;
  if (select count(*) from public.clinical_audit_events)<>0 then raise exception 'FAIL: patient read private audit';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('everwell.other'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('everwell.other'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.blood_analysis_releases)<>0 then raise exception 'FAIL: other patient read approved report';end if;
end $$;
reset role;
-- Ensure both decisions are append-only audited and the original draft remains.
do $$ begin
  if not exists(select 1 from public.clinical_audit_events where report_id=current_setting('everwell.report')::uuid and event='approved' and actor_id=current_setting('everwell.doctor')::uuid) then raise exception 'FAIL: approval not attributed';end if;
  if not exists(select 1 from public.clinical_audit_events where report_id=current_setting('everwell.rejected')::uuid and event='rejected') then raise exception 'FAIL: rejection missing';end if;
  if not exists(select 1 from public.blood_analysis_drafts where report_id=current_setting('everwell.report')::uuid and narrative->>'summary'='PRIVATE AI TEXT') then raise exception 'FAIL: original AI draft not retained';end if;
end $$;
rollback;
