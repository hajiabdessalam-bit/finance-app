-- UNAPPLIED. PLAN private project only, after schema-draft.sql.
-- One bounded counter per owner; verified private server callers only.
create table plan_private.sync_rate (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 minute timestamptz not null,
 requests integer not null check(requests between 1 and 61)
);
alter table plan_private.sync_rate enable row level security;
revoke all on plan_private.sync_rate from public,anon,authenticated;
grant select,insert,update on plan_private.sync_rate to service_role;
create function public.plan_sync_admit(p_owner uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_minute timestamptz:=date_trunc('minute',statement_timestamp());
 v_applied_minute timestamptz;
 v_count integer;
 v_retry integer;
begin
 if current_user<>'service_role' or p_owner is null then raise exception 'Verified private server identity required';end if;
 -- Atomic row lock/UPSERT: no read-then-increment race, no client clock or limit.
 insert into plan_private.sync_rate(owner_id,minute,requests) values(p_owner,v_minute,1)
 on conflict(owner_id) do update set
 requests=case when plan_private.sync_rate.minute>=excluded.minute then least(plan_private.sync_rate.requests+1,61) else 1 end,
 minute=greatest(plan_private.sync_rate.minute,excluded.minute)
 returning requests,minute into v_count,v_applied_minute;
 -- A delayed earlier request cannot roll a newer bucket backwards.
 v_retry:=greatest(1,ceil(extract(epoch from(v_applied_minute+interval '1 minute'-clock_timestamp())))::integer);
 return jsonb_build_object('allowed',v_count<=60,'retryAfterSeconds',case when v_count<=60 then 0 else v_retry end);
end $$;
revoke all on function public.plan_sync_admit(uuid) from public,anon,authenticated;
grant execute on function public.plan_sync_admit(uuid) to service_role;
