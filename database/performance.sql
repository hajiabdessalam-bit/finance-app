-- Cover the budget foreign key without changing access or financial records.
create index if not exists ai_requests_owner_period
 on plan_private.ai_requests(owner_id,period);
