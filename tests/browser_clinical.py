"""Clinical UI contract tests with a simulated Supabase API; no provider or live database."""
import json, os, re
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=re.sub(r'<script src="[^"]+"></script>','',(ROOT/'index.html').read_text())
P='11111111-1111-4111-8111-111111111111';D='22222222-2222-4222-8222-222222222222';X='33333333-3333-4333-8333-333333333333'
R='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
measure=[{'code':'ferritin','unit':'ug/L','collected_on':'2026-09-01','value':18,'reference_low':30,'reference_high':150}]
chart=[{'code':'ferritin','label':'Ferritin','unit':'ug/L','points':[{'date':'2026-09-01','value':18,'low':30,'high':150,'interval_status':'below'}]}]
reports={R:{'id':R,'patient_id':P,'submitted_at':'2026-11-01T10:00:00Z','status':'needs_review','attempt':1,'measurements':measure,'review_note':None}}
drafts={R:{'report_id':R,'analysis_version':1,'model':'test-model','prompt_version':'test-prompt','narrative':{'summary':'SECRET_AI_DRAFT','observations':[{'code':'ferritin','comment':'<img src=x onerror=alert(1)> source verification needed'}],'limitations':['History is unknown.']},'graph_data':chart}}
releases={};workspaces={};requests=[];review_calls=[];errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('EVERWELL_CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 def handler(route):
  req=route.request;url=urlparse(req.url);query=parse_qs(url.query);body=req.post_data_json if req.post_data else {};user=req.headers.get('authorization','').removeprefix('Bearer ')
  requests.append((user,url.path))
  def reply(data=None,status=200):route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body=json.dumps(data))
  if req.method=='OPTIONS':reply();return
  if url.path=='/auth/v1/token':
   user={'patient@example.invalid':P,'doctor@example.invalid':D}.get(body.get('email'),X);reply({'access_token':user,'refresh_token':'test-refresh','expires_in':3600,'user':{'id':user,'email':body.get('email')}});return
  if url.path=='/auth/v1/logout':reply();return
  if user not in [P,D,X]:reply({},401);return
  if url.path=='/rest/v1/everwell_workspaces':
   if req.method=='POST':workspaces[user]={**body,'revision':1};reply([workspaces[user]])
   else:reply([workspaces[user]] if user in workspaces else [])
   return
  if url.path=='/rest/v1/clinical_reviewers':reply([{'active':True,'verified_at':'2026-11-01T00:00:00Z'}] if user==D else []);return
  if url.path=='/rest/v1/lab_reports':
   result=[r for r in reports.values() if r['patient_id']==user or user==D]
   if 'patient_id' in query:
    q=query['patient_id'][0];result=[r for r in result if r['patient_id']==q[3:]] if q.startswith('eq.') else [r for r in result if r['patient_id']!=q[4:]]
   if 'status' in query:result=[r for r in result if r['status']==query['status'][0][3:]]
   if 'id' in query:result=[r for r in result if r['id']==query['id'][0][3:]]
   reply(result);return
  if url.path=='/rest/v1/blood_analysis_releases':reply([v for v in releases.values() if v['patient_id']==user or user==D]);return
  if url.path=='/rest/v1/blood_analysis_drafts':reply([drafts[query['report_id'][0][3:]]] if user==D else []);return
  if url.path=='/functions/v1/analyse-blood':
   assert body['processing_consent'] is True
   rid=body['report_id'];reports[rid]={'id':rid,'patient_id':user,'submitted_at':'2026-11-01T12:00:00Z','status':'needs_review','attempt':1,'measurements':body.get('measurements',measure),'review_note':None};drafts[rid]={**drafts[R],'report_id':rid};reply({'report_id':rid,'status':'needs_review'});return
  if url.path=='/rest/v1/rpc/review_blood_analysis':
   review_calls.append((user,body));r=reports[body['report_id']]
   if user!=D:reply({},403);return
   if body['expected_version']!=1 or r['status']!='needs_review':reply({},409);return
   if body['decision']=='approve':
    assert body['source_verified'];assert body['doctor_note'];r['status']='approved';releases[r['id']]={'report_id':r['id'],'patient_id':r['patient_id'],'summary':body['edited_summary'],'graph_data':chart,'reviewer_name':'Verified test doctor','approved_at':'2026-11-01T13:00:00Z'}
   else:r['status']='rejected'
   r['review_note']=body['doctor_note'];reply();return
  reply({},404)
 def newpage():
  page=b.new_page(viewport={'width':1440,'height':1100});page.set_default_timeout(8000);page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',handler);page.set_content(HTML,wait_until='domcontentloaded');page.add_script_tag(content="window.EVERWELL_SUPABASE_CONFIG={url:'https://mock.supabase.co',publishableKey:'sb_publishable_test'}");page.add_script_tag(content=(ROOT/'supabase-client.js').read_text());page.evaluate("if(!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});");page.add_script_tag(content=(ROOT/'blood-review.js').read_text());return page
 def view(page,name):page.locator('nav [data-view='+name+']').click()
 def signin(page,email):
  view(page,'account');page.locator('#account-email').fill(email);page.locator('#account-password').fill('test-password');page.locator('#account-signin').click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Account · saved'")
 patient=newpage();signin(patient,'patient@example.invalid');view(patient,'blood');patient.wait_for_function("document.querySelector('#blood-report-list').children.length===1")
 assert patient.locator('#review-nav').is_hidden();assert 'SECRET_AI_DRAFT' not in patient.locator('#blood').inner_text();assert patient.locator('#blood .blood-graph').count()==0
 patient.locator('#blood-example').click();patient.locator('#blood-source').check();patient.locator('#blood-consent').check();patient.locator('#blood-generate').click();patient.wait_for_function("document.querySelector('#blood-submit-status').textContent.includes('Draft ready')")
 assert len(reports)==2;assert not any(u==P and path.endswith('blood_analysis_drafts') for u,path in requests)
 doctor=newpage();signin(doctor,'doctor@example.invalid');doctor.wait_for_function("!document.querySelector('#review-nav').hidden");view(doctor,'review');doctor.get_by_role('button',name='Review report',exact=True).first.click();doctor.wait_for_selector('#doctor-final-summary');assert doctor.locator('#doctor-final-summary').input_value()=='SECRET_AI_DRAFT'
 doctor.get_by_role('button',name='Approve and release',exact=True).click();assert not review_calls
 doctor.locator('#doctor-final-summary').fill('DOCTOR_EDITED_FINAL');doctor.locator('#doctor-review-note').fill('Source verified. Reviewed in available context.');doctor.locator('#doctor-verified-source').check();doctor.get_by_role('button',name='Approve and release',exact=True).click();doctor.wait_for_function("document.querySelector('#review-detail').children.length===0")
 assert releases[R]['summary']=='DOCTOR_EDITED_FINAL'
 patient.locator('#blood-refresh').click();patient.wait_for_function("document.querySelector('#blood-report-list').textContent.includes('DOCTOR_EDITED_FINAL')");assert 'SECRET_AI_DRAFT' not in patient.locator('#blood').inner_text();assert patient.locator('#blood .blood-graph').count()==1
 # Reject the remaining draft and verify its graphs stay withheld.
 doctor.get_by_role('button',name='Review report',exact=True).first.click();doctor.locator('#doctor-review-note').fill('Please correct the source values.');doctor.get_by_role('button',name='Reject — keep draft private',exact=True).click();doctor.wait_for_function("document.querySelector('#review-detail').children.length===0");assert len(releases)==1
 stranger=newpage();signin(stranger,'other@example.invalid');view(stranger,'blood');stranger.wait_for_function("document.querySelector('#blood-message').textContent.includes('No reports')");assert not stranger.locator('#blood-report-list').inner_text()
 for width in [1440,768,390]:
  patient.set_viewport_size({'width':width,'height':1000})
  for section in ['overview','blood','account','plan','results','membership','screening','life','learn']:
   view(patient,section);assert patient.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,section)
  doctor.set_viewport_size({'width':width,'height':1000});view(doctor,'review');assert doctor.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors;b.close();print('PASS: patient withholding, doctor-only queue, explicit verification, edited release, rejection, separate accounts and responsive UI. Mock API only; real RLS/provider not exercised.')
