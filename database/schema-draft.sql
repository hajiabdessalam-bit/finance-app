-- Draft schema for PLAN's separate Supabase project. Not applied to any live database.
-- Every financial record belongs to one authenticated, non-anonymous user.
create schema if not exists plan_private;
revoke all on schema plan_private from public, anon;
grant usage on schema plan_private to authenticated;

create table plan_private.workspaces (
  owner_id uuid not null references auth.users(id),
  id text not null,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table plan_private.records (
  owner_id uuid not null,
  workspace_id text not null,
  collection text not null check (collection in ('accounts','transactions','reconciliations','categories','budgets','goals','obligations','outside','notes','holdings','cycleHistory','imports','reservations','preferences')),
  record_key text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null check (version > 0),
  primary key (owner_id, workspace_id, collection, record_key),
  foreign key (owner_id, workspace_id) references plan_private.workspaces(owner_id,id)
);
create table plan_private.operations (
  owner_id uuid not null,
  workspace_id text not null,
  id uuid not null,
  kind text not null,
  applied_version bigint not null check (applied_version > 0),
  patches jsonb not null check (jsonb_typeof(patches) = 'array'),
  created_at timestamptz not null default now(),
  primary key (owner_id,workspace_id,id),
  foreign key (owner_id,workspace_id) references plan_private.workspaces(owner_id,id)
);
alter table plan_private.workspaces enable row level security;
alter table plan_private.records enable row level security;
alter table plan_private.operations enable row level security;
revoke all on all tables in schema plan_private from public,anon,authenticated;
grant select,insert,update on plan_private.workspaces,plan_private.records to authenticated;
grant select,insert on plan_private.operations to authenticated;
create policy own_workspace_read on plan_private.workspaces for select to authenticated using ((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy own_workspace_insert on plan_private.workspaces for insert to authenticated with check ((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy own_workspace_update on plan_private.workspaces for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy own_record_read on plan_private.records for select to authenticated using ((select auth.uid())=owner_id);
create policy own_record_insert on plan_private.records for insert to authenticated with check ((select auth.uid())=owner_id);
create policy own_record_update on plan_private.records for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy own_operation_read on plan_private.operations for select to authenticated using ((select auth.uid())=owner_id);
create policy own_operation_insert on plan_private.operations for insert to authenticated with check ((select auth.uid())=owner_id);

-- Security invoker is deliberate: all work remains subject to the caller's RLS.
create or replace function public.plan_apply_operation(
  p_workspace text, p_operation uuid, p_expected_version bigint, p_kind text, p_patches jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_version bigint;
  patch jsonb;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in with a permanent account' using errcode='42501'; end if;
  if length(p_workspace)>200 or length(p_kind)>100 or jsonb_typeof(p_patches)<>'array' or jsonb_array_length(p_patches)>1000 or octet_length(p_patches::text)>5000000 then raise exception 'Invalid operation'; end if;
  insert into plan_private.workspaces(owner_id,id) values(actor,p_workspace) on conflict do nothing;
  select version into current_version from plan_private.workspaces where owner_id=actor and id=p_workspace for update;
  if exists(select 1 from plan_private.operations where owner_id=actor and workspace_id=p_workspace and id=p_operation) then
    return jsonb_build_object('status','duplicate','version',current_version);
  end if;
  if current_version<>p_expected_version then return jsonb_build_object('status','conflict','version',current_version); end if;
  for patch in select value from jsonb_array_elements(p_patches) loop
    if patch->>'action'<>'put' or length(patch->>'key')>300 or jsonb_typeof(patch->'value')<>'object' then raise exception 'Invalid patch'; end if;
    insert into plan_private.records(owner_id,workspace_id,collection,record_key,data,version)
      values(actor,p_workspace,patch->>'collection',patch->>'key',patch->'value',current_version+1)
      on conflict (owner_id,workspace_id,collection,record_key) do update set data=excluded.data,version=excluded.version;
  end loop;
  insert into plan_private.operations(owner_id,workspace_id,id,kind,applied_version,patches) values(actor,p_workspace,p_operation,p_kind,current_version+1,p_patches);
  update plan_private.workspaces set version=current_version+1 where owner_id=actor and id=p_workspace;
  return jsonb_build_object('status','applied','version',current_version+1);
end $$;
revoke all on function public.plan_apply_operation(text,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.plan_apply_operation(text,uuid,bigint,text,jsonb) to authenticated;

-- Still required before enabling: authenticated/anonymous/other-user RLS tests,
-- a read RPC returning an atomic version + records snapshot, immutable record rules,
-- server-side financial payload validation, advisors and a verified restore drill.
-- No user backup is loaded by this SQL.
