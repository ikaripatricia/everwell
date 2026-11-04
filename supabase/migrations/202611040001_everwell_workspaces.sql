begin;

-- Test integration only. No imported clinical records or automatic sample-data seeding.
create table public.everwell_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  completed_items text[] not null default '{}'
    check (completed_items <@ array['core:screening','core:heart','core:midlife','topic:heart','topic:bone','topic:mind','topic:midlife','result:ferritin','result:vitaminD','result:hba1c']::text[]
      and cardinality(completed_items) <= 10 and array_position(completed_items, null) is null),
  topic_ids text[] not null default '{}'
    check (topic_ids <@ array['heart','bone','mind','midlife']::text[]
      and cardinality(topic_ids) <= 4 and array_position(topic_ids, null) is null),
  result_ids text[] not null default '{}'
    check (result_ids <@ array['ferritin','vitaminD','hba1c']::text[]
      and cardinality(result_ids) <= 3 and array_position(result_ids, null) is null),
  selected_package text not null default 'plus' check (selected_package in ('core','plus','advanced')),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.everwell_workspaces enable row level security;
alter table public.everwell_workspaces force row level security;
revoke all on public.everwell_workspaces from public, anon, authenticated;
grant select, delete on public.everwell_workspaces to authenticated;
grant insert (user_id, display_name, completed_items, topic_ids, result_ids, selected_package)
  on public.everwell_workspaces to authenticated;
grant update (display_name, completed_items, topic_ids, result_ids, selected_package)
  on public.everwell_workspaces to authenticated;

create policy "Read own workspace" on public.everwell_workspaces
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own workspace" on public.everwell_workspaces
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own workspace" on public.everwell_workspaces
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Delete own workspace" on public.everwell_workspaces
  for delete to authenticated using ((select auth.uid()) = user_id);

create function public.everwell_touch_workspace()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.everwell_touch_workspace() from public, anon, authenticated;
create trigger everwell_workspace_revision before update on public.everwell_workspaces
  for each row execute function public.everwell_touch_workspace();

comment on table public.everwell_workspaces is
  'Owner-scoped prevention demo preferences. No clinical results, prescriptions, appointments or clinician records.';
notify pgrst, 'reload schema';
commit;
