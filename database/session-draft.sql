-- UNAPPLIED. PLAN private project only. Verify hosted auth.sessions columns before applying.
-- The server authenticates the exact JWT with Auth before calling this lookup.
grant usage on schema auth to service_role;
grant select(id,user_id) on auth.sessions to service_role;
create function public.plan_session_active(p_owner uuid,p_session uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
 if current_user<>'service_role' or p_owner is null or p_session is null then
  raise exception 'Verified private server identity required';
 end if;
 return exists(select 1 from auth.sessions where id=p_session and user_id=p_owner);
end $$;
revoke all on function public.plan_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.plan_session_active(uuid,uuid) to service_role;
