-- Draft schema for PLAN's separate Supabase project. Not applied to any live database.
-- Every financial record belongs to one authenticated, non-anonymous user.
create schema if not exists plan_private;
revoke all on schema plan_private from public, anon;
grant usage on schema plan_private to authenticated,service_role;

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
grant select on plan_private.workspaces,plan_private.records to authenticated;
grant select,insert,update on plan_private.workspaces,plan_private.records to service_role;
grant select on plan_private.operations to authenticated;
grant select,insert on plan_private.operations to service_role;
create policy own_workspace_read on plan_private.workspaces for select to authenticated using ((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy own_record_read on plan_private.records for select to authenticated using ((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy own_operation_read on plan_private.operations for select to authenticated using ((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));

-- Ledger originals cannot be rewritten, even through an owner's direct SQL access.
create function plan_private.preserve_transaction() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.collection='transactions' and new.data is distinct from old.data then
    raise exception 'Transactions are immutable; append a correction' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function plan_private.preserve_transaction() from public,anon;
create trigger preserve_transaction before update on plan_private.records
for each row execute function plan_private.preserve_transaction();

-- Only the private server can write. Its verified actor and complete-state validation
-- must precede this CAS RPC. Browser users have read-only ownership RLS.
-- Service credentials remain server-side; SECURITY INVOKER does not elevate callers.
create or replace function public.plan_apply_validated_operation(
  p_owner uuid, p_workspace text, p_operation uuid, p_expected_version bigint, p_kind text, p_patches jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := p_owner;
  current_version bigint;
  patch jsonb;
  previous_operation plan_private.operations%rowtype;
begin
  if current_user<>'service_role' or actor is null then raise exception 'Private validated server access required' using errcode='42501'; end if;
  if p_workspace is null or length(p_workspace)<1 or length(p_workspace)>200 or p_kind is null or length(p_kind)<1 or length(p_kind)>100 or p_operation is null or p_expected_version is null or p_expected_version<0 or p_patches is null or jsonb_typeof(p_patches)<>'array' or jsonb_array_length(p_patches)>1000 or octet_length(p_patches::text)>5000000 then raise exception 'Invalid operation'; end if;
  insert into plan_private.workspaces(owner_id,id) values(actor,p_workspace) on conflict do nothing;
  select version into current_version from plan_private.workspaces where owner_id=actor and id=p_workspace for update;
  select * into previous_operation from plan_private.operations where owner_id=actor and workspace_id=p_workspace and id=p_operation;
  if found then
    if previous_operation.kind is distinct from p_kind or previous_operation.patches is distinct from p_patches then
      raise exception 'An operation ID cannot be reused for different content' using errcode='23514';
    end if;
    return jsonb_build_object('status','duplicate','version',current_version);
  end if;
  if current_version<>p_expected_version then return jsonb_build_object('status','conflict','version',current_version); end if;
  for patch in select value from jsonb_array_elements(p_patches) loop
    if patch->>'action' is distinct from 'put' or patch->>'key' is null or length(patch->>'key')<1 or length(patch->>'key')>300 or jsonb_typeof(patch->'value')<>'object' then raise exception 'Invalid patch'; end if;
    insert into plan_private.records as stored_record(owner_id,workspace_id,collection,record_key,data,version)
      values(actor,p_workspace,patch->>'collection',patch->>'key',patch->'value',current_version+1)
      on conflict (owner_id,workspace_id,collection,record_key) do update set data=case when excluded.collection='preferences' and excluded.record_key='profile' then stored_record.data||excluded.data else excluded.data end,version=excluded.version;
  end loop;
  insert into plan_private.operations(owner_id,workspace_id,id,kind,applied_version,patches) values(actor,p_workspace,p_operation,p_kind,current_version+1,p_patches);
  update plan_private.workspaces set version=current_version+1 where owner_id=actor and id=p_workspace;
  return jsonb_build_object('status','applied','version',current_version+1);
end $$;
revoke all on function public.plan_apply_validated_operation(uuid,text,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.plan_apply_validated_operation(uuid,text,uuid,bigint,text,jsonb) to service_role;

-- All fields in this response are read in one MVCC statement snapshot.
create or replace function public.plan_read_workspace(p_workspace text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in with a permanent account' using errcode='42501';
  end if;
  select jsonb_build_object('workspace',w.id,'version',w.version,'records',
    coalesce((select jsonb_agg(jsonb_build_object('collection',r.collection,'key',r.record_key,'value',r.data,'version',r.version) order by r.collection,r.record_key)
      from plan_private.records r where r.owner_id=w.owner_id and r.workspace_id=w.id),'[]'::jsonb),'operations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'type',o.kind,'version',o.applied_version,'patches',o.patches,'at',o.created_at) order by o.applied_version) from plan_private.operations o where o.owner_id=w.owner_id and o.workspace_id=w.id),'[]'::jsonb))
    into result from plan_private.workspaces w where w.owner_id=auth.uid() and w.id=p_workspace;
  return result;
end $$;
revoke all on function public.plan_read_workspace(text) from public,anon;
grant execute on function public.plan_read_workspace(text) to authenticated;

create or replace function public.plan_read_validated_workspace(p_owner uuid,p_workspace text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if current_user<>'service_role' or p_owner is null then
    raise exception 'Private validated server access required' using errcode='42501';
  end if;
  select jsonb_build_object('workspace',w.id,'version',w.version,'records',
    coalesce((select jsonb_agg(jsonb_build_object('collection',r.collection,'key',r.record_key,'value',r.data,'version',r.version) order by r.collection,r.record_key)
      from plan_private.records r where r.owner_id=w.owner_id and r.workspace_id=w.id),'[]'::jsonb),'operations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'type',o.kind,'version',o.applied_version,'patches',o.patches,'at',o.created_at) order by o.applied_version) from plan_private.operations o where o.owner_id=w.owner_id and o.workspace_id=w.id),'[]'::jsonb))
    into result from plan_private.workspaces w where w.owner_id=p_owner and w.id=p_workspace;
  return result;
end $$;
revoke all on function public.plan_read_validated_workspace(uuid,text) from public,anon,authenticated;
grant execute on function public.plan_read_validated_workspace(uuid,text) to service_role;


-- Still required before enabling: verified permanent-user server transport,
-- complete financial validation, bootstrap/conflict UI, advisors and restore drills.
-- No user backup is loaded by this SQL.
