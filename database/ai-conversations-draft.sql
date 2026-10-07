-- UNAPPLIED. Requires schema-draft.sql and ai-budget-draft.sql in PLAN's private project.
-- Only the reviewed question and final answer are retained, never hidden reasoning.
create table plan_private.ai_conversations (
 owner_id uuid not null,request_id uuid not null,workspace_id text not null,
 question text not null check(octet_length(question) between 1 and 20000),
 answer text not null check(octet_length(answer) between 1 and 100000),
 created_at timestamptz not null default statement_timestamp(),
 primary key(owner_id,request_id),
 foreign key(owner_id,request_id) references plan_private.ai_requests(owner_id,id),
 foreign key(owner_id,workspace_id) references plan_private.workspaces(owner_id,id)
);
create index ai_conversations_workspace_history on plan_private.ai_conversations(owner_id,workspace_id,created_at desc,request_id desc);
alter table plan_private.ai_conversations enable row level security;
revoke all on plan_private.ai_conversations from public,anon,authenticated,service_role;
grant select on plan_private.ai_conversations to authenticated;
grant select,insert on plan_private.ai_conversations to service_role;
create policy own_ai_conversation_read on plan_private.ai_conversations for select to authenticated
 using((select auth.uid())=owner_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));

create function public.plan_ai_save_conversation(p_owner uuid,p_request uuid,p_workspace text,p_question text,p_answer text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request plan_private.ai_requests%rowtype;v_saved plan_private.ai_conversations%rowtype;
begin
 if current_user<>'service_role' or p_owner is null then raise exception 'Private server identity required';end if;
 if p_request is null or p_workspace is null or length(p_workspace) not between 1 and 200
 or p_question is null or octet_length(p_question) not between 1 and 20000 or btrim(p_question)=''
 or p_answer is null or octet_length(p_answer) not between 1 and 100000 or btrim(p_answer)='' then raise exception 'Invalid conversation';end if;
 -- Same request lock as durable budget admission/settlement. Repeated writes are immutable.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_request::text,0));
 select * into v_request from plan_private.ai_requests where owner_id=p_owner and id=p_request;
 if not found or v_request.prompt_digest<>encode(sha256(convert_to(p_question,'UTF8')),'hex') then raise exception 'Question does not match the admitted request';end if;
 if not exists(select 1 from plan_private.workspaces where owner_id=p_owner and id=p_workspace and version>0) then raise exception 'Reviewed private workspace required';end if;
 select * into v_saved from plan_private.ai_conversations where owner_id=p_owner and request_id=p_request;
 if found then
  if v_saved.workspace_id<>p_workspace or v_saved.question<>p_question or v_saved.answer<>p_answer then raise exception 'Conversation receipt is immutable';end if;
  return jsonb_build_object('status','duplicate');
 end if;
 insert into plan_private.ai_conversations(owner_id,request_id,workspace_id,question,answer) values(p_owner,p_request,p_workspace,p_question,p_answer);
 return jsonb_build_object('status','saved');
end $$;

create function public.plan_ai_read_conversations(p_owner uuid,p_workspace text,p_before uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_time timestamptz;v_rows jsonb;v_has_more boolean;v_cursor uuid;
begin
 if current_user<>'service_role' or p_owner is null then raise exception 'Private server identity required';end if;
 if p_workspace is null or length(p_workspace) not between 1 and 200 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid history page';end if;
 if p_before is not null then
  select created_at into v_time from plan_private.ai_conversations where owner_id=p_owner and workspace_id=p_workspace and request_id=p_before;
  if not found then return jsonb_build_object('messages','[]'::jsonb,'nextCursor',null);end if;
 end if;
 with page as (
  select request_id,question,answer,created_at from plan_private.ai_conversations where owner_id=p_owner and workspace_id=p_workspace
  and (p_before is null or (created_at,request_id)<(v_time,p_before)) order by created_at desc,request_id desc limit p_limit+1
 ), numbered as (select *,row_number() over(order by created_at desc,request_id desc) as position from page)
 select coalesce(jsonb_agg(jsonb_build_object('requestId',request_id,'question',question,'answer',answer,'at',created_at) order by position) filter(where position<=p_limit),'[]'::jsonb),count(*)>p_limit into v_rows,v_has_more from numbered;
 if v_has_more then v_cursor:=(v_rows->(jsonb_array_length(v_rows)-1)->>'requestId')::uuid;end if;
 return jsonb_build_object('messages',v_rows,'nextCursor',v_cursor);
end $$;
revoke all on function public.plan_ai_save_conversation(uuid,uuid,text,text,text),public.plan_ai_read_conversations(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.plan_ai_save_conversation(uuid,uuid,text,text,text),public.plan_ai_read_conversations(uuid,text,uuid,integer) to service_role;
