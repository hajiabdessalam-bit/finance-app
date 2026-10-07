-- UNAPPLIED. Apply only in PLAN's reviewed private project after schema-draft.sql.
-- USD micro-units are separate from the finance workspace's currency.
create table plan_private.ai_budgets (
 owner_id uuid not null references auth.users(id),period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 limit_micro bigint not null default 0 check(limit_micro between 0 and 1000000000000),used_micro bigint not null default 0 check(used_micro>=0),held_micro bigint not null default 0 check(held_micro>=0),
 max_requests integer not null default 50 check(max_requests between 0 and 1000),requests integer not null default 0 check(requests>=0),paused boolean not null default false,primary key(owner_id,period)
);
create table plan_private.ai_requests (
 owner_id uuid not null,id uuid not null,period text not null,reserved_micro bigint not null check(reserved_micro between 0 and 1000000000000),charged_micro bigint check(charged_micro between 0 and 1000000000000),
 configuration_hash text not null check(configuration_hash ~ '^[a-f0-9]{64}$'),workspace_digest text not null check(workspace_digest ~ '^[a-f0-9]{64}$'),summary_digest text not null check(summary_digest ~ '^[a-f0-9]{64}$'),prompt_digest text not null check(prompt_digest ~ '^[a-f0-9]{64}$'),
 status text not null check(status in('reserved','uncertain','complete','overrun')),created_at timestamptz not null default now(),primary key(owner_id,id),foreign key(owner_id,period) references plan_private.ai_budgets(owner_id,period)
);
alter table plan_private.ai_budgets enable row level security;
alter table plan_private.ai_requests enable row level security;
revoke all on plan_private.ai_budgets,plan_private.ai_requests from public,anon,authenticated;
grant select on plan_private.ai_budgets,plan_private.ai_requests to authenticated;
grant select,insert,update on plan_private.ai_budgets,plan_private.ai_requests to service_role;
create policy own_ai_budget_read on plan_private.ai_budgets for select to authenticated using((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy own_ai_request_read on plan_private.ai_requests for select to authenticated using((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create function public.plan_ai_reserve(p_owner uuid,p_id uuid,p_amount bigint,p_configuration_hash text,p_workspace_digest text,p_summary_digest text,p_prompt_digest text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_period text:=to_char(now() at time zone 'UTC','YYYY-MM');v_budget plan_private.ai_budgets%rowtype;v_request plan_private.ai_requests%rowtype;
begin
 if current_user<>'service_role' or p_owner is null then raise exception 'Private server identity required';end if;
 if p_id is null or p_amount is null or p_amount<0 or p_amount>1000000000000
 or p_configuration_hash is null or p_configuration_hash !~ '^[a-f0-9]{64}$'
 or p_workspace_digest is null or p_workspace_digest !~ '^[a-f0-9]{64}$'
 or p_summary_digest is null or p_summary_digest !~ '^[a-f0-9]{64}$'
 or p_prompt_digest is null or p_prompt_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request context';end if;
 -- Shared order: request advisory lock -> budget row -> request row.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_id::text,0));
 select * into v_request from plan_private.ai_requests where owner_id=p_owner and id=p_id;
 if found then
 if v_request.reserved_micro<>p_amount or v_request.configuration_hash<>p_configuration_hash or v_request.workspace_digest<>p_workspace_digest or v_request.summary_digest<>p_summary_digest or v_request.prompt_digest<>p_prompt_digest then raise exception 'Request ID cannot be reused for different context';end if;
 return jsonb_build_object('status','duplicate','requestStatus',v_request.status);
 end if;
 select * into v_budget from plan_private.ai_budgets where owner_id=p_owner and period=v_period for update;
 if not found or v_budget.paused or v_budget.requests>=v_budget.max_requests or v_budget.used_micro+v_budget.held_micro+p_amount>v_budget.limit_micro then return jsonb_build_object('status','denied');end if;
 insert into plan_private.ai_requests(owner_id,id,period,reserved_micro,configuration_hash,workspace_digest,summary_digest,prompt_digest,status) values(p_owner,p_id,v_period,p_amount,p_configuration_hash,p_workspace_digest,p_summary_digest,p_prompt_digest,'reserved');
 update plan_private.ai_budgets set held_micro=held_micro+p_amount,requests=requests+1 where owner_id=p_owner and period=v_period;
 return jsonb_build_object('status','reserved');
end $$;
create function public.plan_ai_settle(p_owner uuid,p_id uuid,p_status text,p_charged bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request plan_private.ai_requests%rowtype;v_status text;
begin
 if current_user<>'service_role' or p_owner is null then raise exception 'Private server identity required';end if;
 if p_id is null or p_status is null or p_status not in('uncertain','complete','overrun') or(p_status='uncertain' and p_charged is not null) or(p_status<>'uncertain' and(p_charged is null or p_charged<0 or p_charged>1000000000000)) then raise exception 'Invalid settlement';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_id::text,0));
 select * into v_request from plan_private.ai_requests where owner_id=p_owner and id=p_id;
 if not found then raise exception 'Request not found';end if;
 perform 1 from plan_private.ai_budgets where owner_id=p_owner and period=v_request.period for update;
 select * into v_request from plan_private.ai_requests where owner_id=p_owner and id=p_id for update;
 if v_request.status in('complete','overrun') then
 if v_request.status<>p_status or v_request.charged_micro is distinct from p_charged then raise exception 'Settled charge is immutable';end if;
 return jsonb_build_object('status','duplicate');end if;
 if p_status='uncertain' then update plan_private.ai_requests set status='uncertain' where owner_id=p_owner and id=p_id;return jsonb_build_object('status','uncertain');end if;
 v_status:=case when p_charged>v_request.reserved_micro then 'overrun' else 'complete' end;
 if p_status<>v_status then raise exception 'Charge status does not match the reservation';end if;
 update plan_private.ai_requests set status=v_status,charged_micro=p_charged where owner_id=p_owner and id=p_id;
 update plan_private.ai_budgets set held_micro=held_micro-v_request.reserved_micro,used_micro=used_micro+p_charged,paused=paused or v_status='overrun' where owner_id=p_owner and period=v_request.period;
 return jsonb_build_object('status',v_status);
end $$;
revoke all on function public.plan_ai_reserve(uuid,uuid,bigint,text,text,text,text),public.plan_ai_settle(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.plan_ai_reserve(uuid,uuid,bigint,text,text,text,text),public.plan_ai_settle(uuid,uuid,text,bigint) to service_role;
