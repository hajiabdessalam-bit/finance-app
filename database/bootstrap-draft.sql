-- UNAPPLIED. Load after schema-draft.sql. No backup is included in this source.
create table plan_private.bootstrap_receipts (
  owner_id uuid not null,
  workspace_id text not null,
  id uuid not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  records jsonb not null check (jsonb_typeof(records)='array'),
  created_at timestamptz not null default now(),
  primary key(owner_id,workspace_id,id),
  foreign key(owner_id,workspace_id) references plan_private.workspaces(owner_id,id)
);
alter table plan_private.bootstrap_receipts enable row level security;
revoke all on plan_private.bootstrap_receipts from public,anon,authenticated;
grant select,insert on plan_private.bootstrap_receipts to service_role;
-- Receipts are immutable. The records retained here verify a lost-response retry.
create or replace function public.plan_bootstrap_validated_workspace(
  p_owner uuid,p_workspace text,p_request uuid,p_digest text,p_records jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_version bigint; previous plan_private.bootstrap_receipts%rowtype; record jsonb;
begin
  if current_user<>'service_role' or p_owner is null then raise exception 'Private validated server access required' using errcode='42501'; end if;
  if p_workspace is null or length(p_workspace)<1 or length(p_workspace)>200 or p_request is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)<1 or jsonb_array_length(p_records)>10000 or octet_length(p_records::text)>10000000 then raise exception 'Invalid first upload'; end if;
  if (select count(*) from jsonb_array_elements(p_records))<>(select count(distinct (value->>'collection',value->>'key')) from jsonb_array_elements(p_records)) then raise exception 'Duplicate first-upload record'; end if;
  if not exists(select 1 from jsonb_array_elements(p_records) where value->>'collection'='preferences' and value->>'key'='profile' and value->'value'->>'id'=p_workspace) then raise exception 'Missing reviewed workspace profile'; end if;
  insert into plan_private.workspaces(owner_id,id) values(p_owner,p_workspace) on conflict do nothing;
  select version into current_version from plan_private.workspaces where owner_id=p_owner and id=p_workspace for update;
  select * into previous from plan_private.bootstrap_receipts where owner_id=p_owner and workspace_id=p_workspace and id=p_request;
  if found then
    if previous.payload_digest is distinct from p_digest or previous.records is distinct from p_records then raise exception 'First-upload ID cannot be reused for different records' using errcode='23514'; end if;
    return jsonb_build_object('status','duplicate','version',current_version);
  end if;
  if current_version<>0 or exists(select 1 from plan_private.records where owner_id=p_owner and workspace_id=p_workspace) then return jsonb_build_object('status','conflict','version',current_version); end if;
  for record in select value from jsonb_array_elements(p_records) loop
    if record->>'key' is null or length(record->>'key')<1 or length(record->>'key')>300 or jsonb_typeof(record->'value') is distinct from 'object' then raise exception 'Invalid first-upload record'; end if;
    insert into plan_private.records(owner_id,workspace_id,collection,record_key,data,version)
      values(p_owner,p_workspace,record->>'collection',record->>'key',record->'value',1);
  end loop;
  insert into plan_private.bootstrap_receipts(owner_id,workspace_id,id,payload_digest,records) values(p_owner,p_workspace,p_request,p_digest,p_records);
  update plan_private.workspaces set version=1 where owner_id=p_owner and id=p_workspace;
  return jsonb_build_object('status','initialized','version',1);
end $$;
revoke all on function public.plan_bootstrap_validated_workspace(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.plan_bootstrap_validated_workspace(uuid,text,uuid,text,jsonb) to service_role;
