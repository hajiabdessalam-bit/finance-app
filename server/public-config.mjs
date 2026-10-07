/** Public connection metadata only. Never return credentials or finance records. */
export function publicConnection({env={}}={}){
 let project;try{project=new URL(env.PLAN_SUPABASE_URL);}catch{return null;}
 if(env.PLAN_PRIVATE_DATABASE_VERIFIED!=='true'||env.PLAN_PRIVATE_SYNC_ENABLED!=='true'||project.origin!==env.PLAN_SUPABASE_URL||project.protocol!=='https:'||project.port||!/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname)||!/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(env.PLAN_SUPABASE_PUBLISHABLE_KEY||''))return null;
 return {projectUrl:project.origin,publishableKey:env.PLAN_SUPABASE_PUBLISHABLE_KEY,aiEnabled:env.PLAN_PRIVATE_ADVISOR_ENABLED==='true'&&env.PLAN_AI_PROVIDER_VERIFIED==='true'};
}
export function configuredPublicConfig({env={}}={}){
 return async request=>{
  const headers={'cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  const url=new URL(request.url);
  if(url.origin!==env.PLAN_APP_ORIGIN||url.pathname!=='/api/plan/config'||url.search)return Response.json({error:'not_found'},{status:404,headers});
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{...headers,allow:'GET'}});
  const config=publicConnection({env});return config?Response.json(config,{headers}):Response.json({error:'private_connection_not_configured'},{status:503,headers});
 };
}
