import test from 'node:test';
import assert from 'node:assert/strict';
const config={EVERWELL_ANALYSIS_ENABLED:'true',EVERWELL_ALLOWED_ORIGINS:'http://localhost:8000',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_ANON_KEY:'public-test-key',SUPABASE_SERVICE_ROLE_KEY:'server-test-key',OPENAI_API_KEY:'provider-test-key',EVERWELL_AI_MODEL:'configured-model'};
let handler;globalThis.Deno={env:{get:key=>config[key]},serve:fn=>{handler=fn}};
await import('../supabase/functions/analyse-blood/index.ts');
const id='11111111-1111-4111-8111-111111111111';
const measurement={code:'ferritin',unit:'ug/L',collected_on:'2026-09-01',value:18,reference_low:30,reference_high:150};
const draft={summary:'PRIVATE_AI_DRAFT',observations:[{code:'ferritin',comment:'Below supplied interval.'}],limitations:['Original source requires doctor verification.']};
const originalFetch=globalThis.fetch;
function setup({owns=true,refuse=false,finished=true,auth=true}={}){
 const calls=[];
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;calls.push({url:String(url),path,body:options.body?JSON.parse(options.body):null,headers:options.headers});
  let output;
  if(path==='/auth/v1/user')return Response.json({id:'patient-id'},{status:auth?200:401});
  if(path==='/rest/v1/rpc/submit_lab_report')output=id;
  else if(path==='/rest/v1/lab_reports')output=owns?[{id,status:'received'}]:[];
  else if(path==='/rest/v1/rpc/claim_blood_analysis')output=[{id,attempt:1,measurements:[measurement]}];
  else if(path==='/v1/responses')output={id:'provider-response-test',status:'completed',output:[{type:'message',content:refuse?[{type:'refusal',refusal:'No draft'}]:[{type:'output_text',text:JSON.stringify(draft)}]}]};
  else if(path==='/rest/v1/rpc/finish_blood_analysis')output=finished;
  else if(path==='/rest/v1/rpc/fail_blood_analysis')output=null;
  else throw new Error('Unexpected path '+path);
  return Response.json(output);
 };return calls;
}
const request=(body={},headers={})=>new Request('https://test-project.supabase.co/functions/v1/analyse-blood',{method:'POST',headers:{Origin:'http://localhost:8000',Authorization:'Bearer patient-token','Content-Type':'application/json',...headers},body:JSON.stringify({action:'submit',report_id:id,measurements:[measurement],processing_consent:true,...body})});
test('worker stores a draft but returns status only, never private narrative or graphs',async()=>{
 const calls=setup();const res=await handler(request());assert.equal(res.status,200);assert.deepEqual(await res.json(),{report_id:id,status:'needs_review'});
 const finish=calls.find(c=>c.path.endsWith('finish_blood_analysis'));assert.equal(finish.body.draft.summary,'PRIVATE_AI_DRAFT');assert.equal(finish.body.charts[0].points[0].value,18);
 const provider=calls.find(c=>c.path==='/v1/responses');assert.equal(provider.body.store,false);assert.equal(provider.headers.Authorization,'Bearer provider-test-key');assert(!provider.body.input.includes('patient-id'));
 assert(!calls.some(c=>c.path.endsWith('review_blood_analysis')||c.path.includes('blood_analysis_releases')));
});
test('non-owner cannot trigger privileged analysis even with a valid signed-in identity',async()=>{
 const calls=setup({owns:false});const res=await handler(request({action:'retry'}));assert.equal(res.status,403);assert(!calls.some(c=>c.path.endsWith('claim_blood_analysis')||c.path==='/v1/responses'));
});
test('missing consent and unauthenticated submissions cannot reach the provider',async()=>{
 let calls=setup();assert.equal((await handler(request({processing_consent:false}))).status,400);assert(!calls.some(c=>c.path==='/v1/responses'));
 calls=setup({auth:false});assert.equal((await handler(request())).status,401);assert(!calls.some(c=>c.path==='/v1/responses'));
});
test('refusal marks analysis failed without release; stale worker completion is rejected',async()=>{
 let calls=setup({refuse:true});assert.equal((await handler(request())).status,502);assert(calls.some(c=>c.path.endsWith('fail_blood_analysis')));assert(!calls.some(c=>c.path.endsWith('finish_blood_analysis')));
 calls=setup({finished:false});assert.equal((await handler(request())).status,409);
});
test('disabled configuration and unlisted origins fail closed',async()=>{
 let calls=setup();config.EVERWELL_ANALYSIS_ENABLED='false';assert.equal((await handler(request())).status,503);assert.equal(calls.length,0);config.EVERWELL_ANALYSIS_ENABLED='true';
 assert.equal((await handler(request({}, {Origin:'https://unlisted.example'}))).status,403);assert.equal(calls.length,0);
});
process.on('exit',()=>{globalThis.fetch=originalFetch});
