-- Run in a Supabase TEST project's SQL editor after the migration, as an administrator.
-- Creates temporary fixture accounts inside this transaction; always rolls back.
-- This is an access-control integration test, not a production migration.
begin;
select set_config('everwell.test_a', gen_random_uuid()::text, true);
select set_config('everwell.test_b', gen_random_uuid()::text, true);
insert into auth.users(id, email) values
  (current_setting('everwell.test_a')::uuid, 'everwell-test-a@example.invalid'),
  (current_setting('everwell.test_b')::uuid, 'everwell-test-b@example.invalid');

set local role anon;
do $$
begin
  begin
    perform * from public.everwell_workspaces;
    raise exception 'FAIL: anonymous SELECT was permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.everwell_workspaces(user_id) values (current_setting('everwell.test_a')::uuid);
    raise exception 'FAIL: anonymous INSERT was permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.everwell_workspaces set display_name='anonymous';
    raise exception 'FAIL: anonymous UPDATE was permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.everwell_workspaces;
    raise exception 'FAIL: anonymous DELETE was permitted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('everwell.test_a'), true);
select set_config('request.jwt.claims', json_build_object('sub',current_setting('everwell.test_a'),'role','authenticated')::text, true);
insert into public.everwell_workspaces(user_id, display_name)
  values(current_setting('everwell.test_a')::uuid,'Alice test');
do $$
begin
  if (select count(*) from public.everwell_workspaces) <> 1 then raise exception 'FAIL: own row is not readable'; end if;
  update public.everwell_workspaces set completed_items=array['core:heart'];
  if (select revision from public.everwell_workspaces) <> 2 then raise exception 'FAIL: revision did not increment'; end if;
  begin
    insert into public.everwell_workspaces(user_id) values(current_setting('everwell.test_b')::uuid);
    raise exception 'FAIL: cross-user INSERT was permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.everwell_workspaces set revision=999;
    raise exception 'FAIL: client could alter server revision';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.everwell_workspaces set completed_items=array['unrecognised-task'];
    raise exception 'FAIL: invalid task was accepted';
  exception when check_violation then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('everwell.test_b'), true);
select set_config('request.jwt.claims', json_build_object('sub',current_setting('everwell.test_b'),'role','authenticated')::text, true);
do $$
declare n integer;
begin
  if (select count(*) from public.everwell_workspaces) <> 0 then raise exception 'FAIL: B can read A'; end if;
  update public.everwell_workspaces set display_name='intruder';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B can update A'; end if;
  delete from public.everwell_workspaces;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B can delete A'; end if;
end $$;
insert into public.everwell_workspaces(user_id,display_name) values(current_setting('everwell.test_b')::uuid,'Bob test');
delete from public.everwell_workspaces;
do $$ begin
  if (select count(*) from public.everwell_workspaces) <> 0 then raise exception 'FAIL: own deletion failed'; end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('everwell.test_a'), true);
select set_config('request.jwt.claims', json_build_object('sub',current_setting('everwell.test_a'),'role','authenticated')::text, true);
do $$ begin
  if (select count(*) from public.everwell_workspaces) <> 1 then raise exception 'FAIL: B deleted A'; end if;
end $$;
reset role;
rollback;
-- Success: no exception; both fixture accounts and all changes are rolled back.
