"""UI integration checks against a fake Supabase HTTP API. No real service calls.
Run: python3 tests/browser_supabase.py (requires playwright and Chromium).
These checks do not validate deployed PostgreSQL/RLS; run the SQL test separately.
"""
from pathlib import Path
import json, os, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = re.sub(r'<script src="[^"]+"></script>', '', (ROOT/'index.html').read_text())
CLIENT = (ROOT/'supabase-client.js').read_text()
PROJECT = 'https://everwell-test.supabase.co'
ALICE='11111111-1111-4111-8111-111111111111'
BOB='22222222-2222-4222-8222-222222222222'
rows={}; errors=[]; calls=[]; fail_save=False; conflict=False; expire_token=False; refreshes=0

with sync_playwright() as p:
    executable = os.environ.get('EVERWELL_CHROMIUM','/usr/bin/chromium')
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    def handler(route):
        global fail_save, conflict, refreshes
        req=route.request; url=urlparse(req.url)
        def reply(body=None,status=200):
            route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body=json.dumps(body))
        if url.netloc!='everwell-test.supabase.co':
            errors.append('Unexpected network destination');route.abort();return
        calls.append((req.method,url.path))
        if req.method=='OPTIONS':reply();return
        body=req.post_data_json if req.post_data else {}
        if url.path=='/auth/v1/token':
            if parse_qs(url.query).get('grant_type')==['refresh_token']:
                refreshes+=1; user=ALICE if body['refresh_token']=='refresh-alice' else BOB
            else:
                if body.get('password')=='bad-password':reply({'error_code':'invalid_credentials'},400);return
                user=ALICE if body.get('email')=='alice@example.invalid' else BOB
            name='alice' if user==ALICE else 'bob'
            reply({'access_token':name+'-token','refresh_token':'refresh-'+name,'expires_in':1 if expire_token and not refreshes else 3600,'user':{'id':user,'email':name+'@example.invalid'}});return
        if url.path=='/auth/v1/signup':reply({'user':{'id':ALICE}});return
        if url.path=='/auth/v1/logout':reply();return
        if url.path!='/rest/v1/everwell_workspaces':reply({},404);return
        bearer=req.headers.get('authorization','');owner=ALICE if bearer=='Bearer alice-token' else BOB if bearer=='Bearer bob-token' else None
        if not owner:reply({},401);return
        query=parse_qs(url.query)
        if req.method=='GET':reply([rows[owner]] if owner in rows else []);return
        if req.method=='POST':
            assert body['user_id']==owner
            if owner in rows:reply({},409);return
            rows[owner]={**body,'revision':1};reply([rows[owner]]);return
        if req.method=='DELETE':rows.pop(owner,None);reply();return
        if req.method=='PATCH':
            if fail_save:reply({},503);return
            assert body.get('user_id') is None
            assert set(body)=={'completed_items','topic_ids','result_ids','selected_package','display_name'}
            if conflict or owner not in rows or query.get('revision')!=['eq.'+str(rows[owner]['revision'])]:reply([]);return
            rows[owner].update(body);rows[owner]['revision']+=1;reply([{'revision':rows[owner]['revision']}]);return
        reply({},405)
    def page_for(key='sb_publishable_test_only'):
        page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(6000)
        page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',handler)
        page.set_content(HTML,wait_until='domcontentloaded')
        page.add_script_tag(content='window.EVERWELL_SUPABASE_CONFIG='+json.dumps({'url':PROJECT,'publishableKey':key}))
        page.add_script_tag(content=CLIENT);return page
    def view(page,name):page.locator('nav [data-view='+name+']').click()
    def sign_in(page,email='alice@example.invalid'):
        view(page,'account');page.locator('#account-email').fill(email);page.locator('#account-password').fill('test-password');page.locator('#account-signin').click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Account · saved'")
    def saved(page):page.wait_for_function("document.querySelector('#account-indicator').textContent==='Account · saved'")
    # Unconfigured and privileged keys must never initiate account requests.
    for bad_key in ['', 'sb_secret_test_only','eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature']:
        before=len(calls);page=page_for(bad_key);view(page,'account');assert page.locator('#account-unavailable').is_visible();assert len(calls)==before;page.close()
    page=page_for();view(page,'account');page.locator('#account-email').fill('alice@example.invalid');page.locator('#account-password').fill('bad-password');page.locator('#account-signin').click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Not signed in'");assert page.locator('#account-password').input_value()=='';assert ALICE not in rows
    sign_in(page)
    assert rows[ALICE]['completed_items']==[]
    # Stable checklist IDs: adding a result later must not move existing completion.
    view(page,'learn');page.get_by_role('button',name='Bone & muscle health').click();page.get_by_role('button',name='Add to GP discussion').click()
    view(page,'plan');page.get_by_label('Discuss bone & muscle health').check()
    view(page,'results');page.get_by_role('button',name='Add result to GP discussion').click();saved(page)
    assert rows[ALICE]['completed_items']==['topic:bone'];assert rows[ALICE]['result_ids']==['ferritin']
    view(page,'membership');page.get_by_role('button',name='Explore Core',exact=True).click();saved(page)
    view(page,'account');page.locator('#account-display-name').fill('<script>Alice</script>');saved(page)
    assert page.locator('#profile-name').inner_text()=='<script>Alice</script>'
    assert rows[ALICE]['selected_package']=='core'
    with page.expect_download() as d:
        view(page,'plan');page.get_by_role('button',name='Download GP discussion notes').click()
    assert '[x] Discuss bone & muscle health' in Path(d.value.path()).read_text()
    # Refresh/new page requires a new in-memory sign-in, then reloads server preferences.
    page.close();page=page_for();assert page.locator('#profile-mode').inner_text()=='· Demo';sign_in(page)
    view(page,'plan');assert page.get_by_label('Discuss bone & muscle health').is_checked()
    assert page.locator('#ew-selected-plan').inner_text()=='Exploring Core'
    view(page,'account');page.locator('#account-signout').click();assert page.locator('#profile-name').inner_text()=='Patty';assert page.locator('#stepcount').inner_text()=='3'
    sign_in(page,'bob@example.invalid');assert rows[BOB]['topic_ids']==[];assert page.locator('#profile-name').inner_text()=='Your account'
    # Network failure retains unsaved local state and supports retry.
    fail_save=True;view(page,'membership');page.get_by_role('button',name='Explore Advanced',exact=True).click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Not saved'")
    assert rows[BOB]['selected_package']=='plus';fail_save=False;view(page,'account');page.locator('#account-retry').click();saved(page);assert rows[BOB]['selected_package']=='advanced'
    # Optimistic conflict must not overwrite a different session's revision.
    conflict=True;view(page,'membership');page.get_by_role('button',name='Explore Core',exact=True).click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Save conflict'");assert rows[BOB]['selected_package']=='advanced'
    view(page,'account');assert page.locator('#account-retry').is_disabled();conflict=False;page.once('dialog',lambda d:d.accept());page.locator('#account-reload').click();saved(page);assert page.locator('#ew-selected-plan').inner_text()=='Exploring Advanced'
    # Delete only the current user's application data; do not recreate it implicitly.
    page.once('dialog',lambda d:d.accept());page.locator('#account-delete').click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Workspace deleted'");assert BOB not in rows;assert ALICE in rows
    page.locator('#account-signout').click()
    # Signup confirmation flow does not imply an authenticated session.
    page.locator('#account-email').fill('test@example.invalid');page.locator('#account-password').fill('test-password');page.locator('#account-signup').click();page.wait_for_function("document.querySelector('#account-indicator').textContent==='Confirm email'");assert page.locator('#account-password').input_value()==''
    page.close()
    # Short-lived access tokens use the refresh endpoint before a database request.
    expire_token=True;page=page_for();sign_in(page);assert refreshes>=1
    for width in [1440,768,390]:
        page.set_viewport_size({'width':width,'height':900})
        for name in ['overview','account','plan','results','membership','screening','life','learn']:
            view(page,name);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,name)
    assert not errors,errors
    browser.close()
    print('PASS: mocked auth, scoped persistence, stable IDs, profile escaping, reload, cross-account reset, retry, conflict, delete, confirmation, refresh and responsive navigation. Live Supabase/RLS not exercised.')
