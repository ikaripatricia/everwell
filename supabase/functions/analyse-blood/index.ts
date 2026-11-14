import {validateMeasurements, buildGraphs, parseDraftResponse, providerRequest, PROMPT_VERSION} from '../_shared/blood-analysis.mjs';

// Deploy only to the configured TEST project. Secrets live in Edge Function settings.
Deno.serve(async (req: Request) => {
  const allowed=(Deno.env.get('EVERWELL_ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean);
  const origin=req.headers.get('Origin');
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin']=origin;
    headers['Access-Control-Allow-Headers']='authorization, apikey, content-type';
    headers['Access-Control-Allow-Methods']='POST, OPTIONS';
  }
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if (origin && !allowed.includes(origin)) return reply(403,{error:'origin_not_allowed'});
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST') return reply(405,{error:'method_not_allowed'});
  const project=Deno.env.get('SUPABASE_URL');
  const publicKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const providerKey=Deno.env.get('OPENAI_API_KEY');
  const model=Deno.env.get('EVERWELL_AI_MODEL');
  if (Deno.env.get('EVERWELL_ANALYSIS_ENABLED')!=='true' || !allowed.length || !project || !publicKey || !serviceKey || !providerKey || !model) return reply(503,{error:'analysis_not_configured'});
  const authorization=req.headers.get('Authorization')||'';
  if (!/^Bearer \S+$/.test(authorization)) return reply(401,{error:'sign_in_required'});
  let workerReport:string|undefined, workerAttempt:number|undefined;
  async function api(path:string, body:unknown, admin=false) {
    const r=await fetch(project+path,{method:'POST',headers:{apikey:admin?serviceKey!:publicKey!,Authorization:admin?'Bearer '+serviceKey:authorization,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if (!r.ok) throw Object.assign(new Error('Database operation failed'),{status:r.status});
    const txt=await r.text(); return txt?JSON.parse(txt):null;
  }
  try {
    const auth=await fetch(project+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:authorization},signal:AbortSignal.timeout(10000)});
    if (!auth.ok) return reply(401,{error:'sign_in_required'});
    const user=await auth.json();
    if (!user.id) return reply(401,{error:'sign_in_required'});
    const raw=await req.text();
    if (raw.length>65536) return reply(413,{error:'report_too_large'});
    let body;try {body=JSON.parse(raw);} catch {return reply(400,{error:'invalid_json'});}
    if (!body || !['submit','retry'].includes(body.action) || body.processing_consent!==true || typeof body.report_id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.report_id)) return reply(400,{error:'invalid_submission_or_consent'});
    const id=body.report_id;
    if (body.action==='submit') {
      let measurements; try {measurements=validateMeasurements(body.measurements);} catch {return reply(422,{error:'invalid_measurements'});}
      await api('/rest/v1/rpc/submit_lab_report',{report_id:id,result_rows:measurements,consent_confirmed:true});
    }
    // Check ownership with the caller's JWT before doing anything with service privileges.
    const owned=await fetch(project+'/rest/v1/lab_reports?id=eq.'+id+'&patient_id=eq.'+user.id+'&select=id,status',{
      headers:{apikey:publicKey,Authorization:authorization},signal:AbortSignal.timeout(10000)});
    if (!owned.ok) return reply(403,{error:'report_not_accessible'});
    const ownedRows=await owned.json();
    if (!ownedRows.length) return reply(403,{error:'report_not_accessible'});
    const claimed=await api('/rest/v1/rpc/claim_blood_analysis',{report_id:id},true);
    if (!claimed?.length) return reply(409,{error:'already_processing_reviewed_or_retry_limit'});
    const report=claimed[0];workerReport=id;workerAttempt=report.attempt;
    const measurements=validateMeasurements(report.measurements);
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:'Bearer '+providerKey,'Content-Type':'application/json'},
      body:JSON.stringify(providerRequest(model,measurements)),signal:AbortSignal.timeout(55000)
    });
    if (!response.ok) throw new Error('Provider unavailable');
    const result=await response.json();
    const draft=parseDraftResponse(result,measurements);
    const stored=await api('/rest/v1/rpc/finish_blood_analysis',{
      report_id:id,expected_attempt:report.attempt,draft,charts:buildGraphs(measurements),
      model_name:typeof result.model==='string'?result.model:model,prompt_id:PROMPT_VERSION,response_id:typeof result.id==='string'?result.id:null
    },true);
    if (!stored) return reply(409,{error:'analysis_version_changed'});
    // Never return unapproved narrative/graphs to the patient, including in this function response.
    return reply(200,{report_id:id,status:'needs_review'});
  } catch (error) {
    if (workerReport && workerAttempt) {
      try {await api('/rest/v1/rpc/fail_blood_analysis',{report_id:workerReport,expected_attempt:workerAttempt},true);} catch {/* Operator can recover stale jobs; do not log health data or provider errors. */}
    }
    if ((error as {status?:number}).status===403) return reply(403,{error:'verified_doctor_assignment_or_permission_required'});
    return reply(502,{error:'analysis_unavailable_no_report_released'});
  }
});
