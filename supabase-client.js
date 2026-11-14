/* Everwell test-workspace persistence using Supabase Auth and its REST Data API.
 * No secret/service-role key, SDK download, localStorage, or clinical result upload.
 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const ui = Object.fromEntries(['db-status','db-error','account-indicator','account-unavailable','account-form',
    'account-signedin','account-email','account-password','account-email-label','account-display-name',
    'account-signin','account-signup','account-retry','account-reload','account-signout','account-delete']
    .map(id => [id, byId(id)]));
  const model = window.EverwellState;
  const config = window.EVERWELL_SUPABASE_CONFIG || {};
  let origin = '', key = '', session = null, revision = null, displayName = '';
  let generation = 0, ready = false, dirty = false, writing = false, conflicted = false;
  let timer = null, refreshPromise = null, inFlight = null;
  let controller = new AbortController();
  let authenticating = false;
  const empty = () => ({completed_items:[],topic_ids:[],result_ids:[],selected_package:'plus'});
  const status = (text, short) => {
    ui['db-status'].textContent = text;
    ui['account-indicator'].textContent = short || text;
  };
  const errorText = text => { ui['db-error'].textContent = text; };
  function profile(name, signedIn) {
    const safeName = name.trim() || (signedIn ? 'Your account' : 'Patty');
    byId('profile-name').textContent = safeName;
    byId('profile-avatar').textContent = safeName.charAt(0).toUpperCase();
    byId('profile-mode').textContent = signedIn ? '· Test account' : '· Demo';
    byId('welcome-name').textContent = 'Welcome, ' + safeName + '.';
    byId('workspace-notice').textContent = signedIn
      ? 'TEST ACCOUNT · Only your plan preferences are saved. All lab results remain fictional; no appointments, pathology orders or clinical monitoring.'
      : 'VICTORIA PILOT CONCEPT · Fictional profile and sample results. No live appointments, pathology orders or clinical monitoring.';
  }
  function validConfig() {
    try {
      const u = new URL(config.url);
      const local = ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
      if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || u.search || u.hash || u.pathname !== '/') return false;
      const candidate = String(config.publishableKey || '');
      let anon = false;
      if (candidate.split('.').length === 3) {
        const segment = candidate.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        const claims = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length/4)*4,'=')));
        anon = claims.role === 'anon';
      }
      if (!candidate.startsWith('sb_publishable_') && !anon) return false;
      origin = u.origin; key = candidate; return true;
    } catch { return false; }
  }
  function present() {
    const signedIn = Boolean(session);
    ui['account-form'].hidden = signedIn;
    ui['account-signedin'].hidden = !signedIn;
    ui['account-email-label'].textContent = signedIn ? session.user.email || '' : '';
    ui['account-display-name'].value = displayName;
    ui['account-display-name'].disabled = !ready;
    ui['account-retry'].disabled = !ready || !dirty || conflicted;
    ui['account-reload'].disabled = !signedIn;
    ui['account-delete'].disabled = !ready;
    profile(displayName, signedIn);
  }
  function message(e) {
    if (e.name === 'AbortError') return '';
    if (e.status === 401 || e.code === 'invalid_credentials') return 'Sign-in was not accepted. Check your email and password or sign in again.';
    if (e.code === 'email_not_confirmed') return 'Confirm your email before signing in.';
    if (e.status === 429) return 'Too many attempts. Wait a little before trying again.';
    if (e.status === 403 || e.code === '42501') return 'Your account cannot access the workspace. The test database permissions need checking.';
    if (e.status === 404 || e.code === '42P01' || e.code === 'PGRST205') return 'The workspace table is not available yet. The test database setup needs to be completed.';
    return 'The request could not be completed. Check your connection and try again. Your changes have not been confirmed as saved.';
  }
  async function request(path, options = {}, token, signal = controller.signal) {
    const response = await fetch(origin + path, {
      ...options, signal, cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer',
      headers:{apikey:key, ...(token ? {Authorization:'Bearer ' + token} : {}),
        'Content-Type':'application/json', ...(options.headers || {})}
    });
    const text = await response.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const error = new Error('Supabase request failed');
      error.status = response.status; error.code = body?.code || body?.error_code || '';
      throw error;
    }
    return body;
  }
  async function accessToken() {
    if (!session) throw Object.assign(new Error('Not signed in'), {status:401});
    if (session.expiresAt > Date.now() + 60000) return session.access_token;
    if (!refreshPromise) {
      const epoch = generation;
      const refreshToken = session.refresh_token;
      refreshPromise = request('/auth/v1/token?grant_type=refresh_token', {
        method:'POST', body:JSON.stringify({refresh_token:refreshToken})
      }).then(data => {
        if (generation !== epoch) throw new DOMException('Session changed','AbortError');
        session = {...data, expiresAt:Date.now() + Number(data.expires_in || 3600)*1000};
        return session.access_token;
      }).finally(() => { if (epoch === generation) refreshPromise = null; });
    }
    return refreshPromise;
  }
  const columns = 'user_id,display_name,completed_items,topic_ids,result_ids,selected_package,revision';
  const query = () => '/rest/v1/everwell_workspaces?user_id=eq.' + encodeURIComponent(session.user.id);
  async function loadWorkspace() {
    const epoch = generation;
    const token = await accessToken();
    if (epoch !== generation) return;
    ready = false; present(); status('Loading your saved plan…', 'Loading…'); errorText('');
    let rows = await request(query() + '&select=' + columns, {}, token);
    if (epoch !== generation) return;
    if (!Array.isArray(rows)) throw new Error('Invalid workspace response');
    if (!rows.length) {
      try {
        rows = await request('/rest/v1/everwell_workspaces?select=' + columns, {
          method:'POST', headers:{Prefer:'return=representation'},
          body:JSON.stringify({user_id:session.user.id,display_name:'',...empty()})
        }, token);
      } catch (e) {
        if (e.status !== 409) throw e;
        rows = await request(query() + '&select=' + columns, {}, token);
      }
    }
    if (epoch !== generation) return;
    const row = rows?.[0];
    if (!row || row.user_id !== session.user.id || !Number.isSafeInteger(row.revision)) throw new Error('Invalid workspace response');
    revision = row.revision; displayName = row.display_name || '';
    model.restore(row); dirty = false; conflicted = false; ready = true;
    status('Your plan is loaded. Changes save automatically while signed in.', 'Account · saved');
    present();
  }
  function changed() {
    if (!session || !ready) return;
    dirty = true;
    if (conflicted) {
      status('A newer saved plan exists. Reload it before making more changes.', 'Save conflict');
      errorText('Your local changes have not been saved. Reload saved plan to use the latest version.');
      present(); return;
    }
    errorText('');
    status('You have changes waiting to save.', 'Unsaved changes'); present();
    clearTimeout(timer);
    if (!conflicted) timer = setTimeout(() => save(), 350);
  }
  function save() {
    if (!session || !ready || !dirty || conflicted) return Promise.resolve();
    if (writing) return inFlight;
    const epoch = generation;
    const payload = {...model.snapshot(), display_name:displayName};
    dirty = false; writing = true;
    status('Saving your plan…', 'Saving…');
    inFlight = (async () => {
      try {
        const token = await accessToken();
        if (epoch !== generation) return;
        const rows = await request(query() + '&revision=eq.' + revision + '&select=revision', {
          method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(payload)
        }, token);
        if (epoch !== generation) return;
        if (!Array.isArray(rows) || !rows.length) {
          conflicted = true; dirty = true;
          status('A newer saved plan exists. Reload it before making more changes.', 'Save conflict');
          errorText('Your local changes have not been saved. Reload saved plan to discard them and use the latest version.');
          return;
        }
        if (!Number.isSafeInteger(rows[0].revision)) throw new Error('Invalid revision');
        revision = rows[0].revision;
        if (!dirty) { status('Your plan has been saved to your account.', 'Account · saved'); errorText(''); }
      } catch (e) {
        if (epoch !== generation || e.name === 'AbortError') return;
        dirty = true; status('Your changes are not saved. Retry when connected.', 'Not saved'); errorText(message(e));
      } finally {
        if (epoch === generation) {
          writing = false; inFlight = null; present();
        }
      }
    })();
    return inFlight.then(() => {
      if (epoch === generation && dirty && !conflicted && !ui['db-error'].textContent) return save();
    });
  }
  function resetSession() {
    generation++; clearTimeout(timer); controller.abort(); controller = new AbortController();
    session = null; revision = null; displayName = ''; ready = false; dirty = false;
    conflicted = false; writing = false; inFlight = null; refreshPromise = null;
    model.reset(); present();
    window.dispatchEvent(new Event('everwell:auth'));
  }
  async function authenticate(signup) {
    const form = ui['account-form'];
    if (authenticating || !form.reportValidity()) return;
    authenticating = true;
    const email = ui['account-email'].value.trim();
    const password = ui['account-password'].value;
    ui['account-signin'].disabled = true; ui['account-signup'].disabled = true;
    errorText(''); status(signup ? 'Creating a test account…' : 'Signing in…', 'Connecting…');
    try {
      const data = await request(signup ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', {
        method:'POST', body:JSON.stringify({email,password})
      });
      if (!data?.access_token) {
        status('If registration is available, check your email to confirm the account, then sign in.', 'Confirm email');
        return;
      }
      if (!data.user?.id || !data.refresh_token) throw new Error('Invalid sign-in response');
      resetSession();
      session = {...data, expiresAt:Date.now() + Number(data.expires_in || 3600)*1000};
      present(); window.dispatchEvent(new Event('everwell:auth')); await loadWorkspace();
    } catch (e) {
      if (e.name === 'AbortError') return;
      errorText(message(e)); status(session ? 'Signed in, but your saved plan could not be loaded.' : 'Sign-in has not completed.', session ? 'Plan unavailable' : 'Not signed in');
    } finally {
      authenticating = false;
      ui['account-password'].value = '';
      ui['account-signin'].disabled = false; ui['account-signup'].disabled = false;
    }
  }
  ui['account-form'].addEventListener('submit', e => { e.preventDefault(); authenticate(false); });
  ui['account-signup'].addEventListener('click', () => authenticate(true));
  ui['account-display-name'].addEventListener('input', e => {
    displayName = e.target.value.slice(0,80); profile(displayName, true); changed();
  });
  ui['account-retry'].addEventListener('click', () => { errorText(''); save(); });
  ui['account-reload'].addEventListener('click', async () => {
    if (dirty && !window.confirm('Reloading will discard your unsaved local changes. Continue?')) return;
    const epoch = generation;
    ready = false; present(); clearTimeout(timer);
    if (writing) await inFlight;
    if (epoch !== generation) return;
    try { await loadWorkspace(); } catch (e) { if (epoch === generation) { errorText(message(e)); status('Your saved plan could not be loaded.', 'Plan unavailable'); } }
  });
  ui['account-signout'].addEventListener('click', async () => {
    if ((dirty || writing) && !window.confirm('There are changes that may not be saved. Sign out and discard them?')) return;
    const token = session?.access_token;
    resetSession(); const epoch = generation; errorText(''); status('Signed out. You are now exploring a fresh demo.', 'Demo · not saved');
    if (token) {
      try { await request('/auth/v1/logout?scope=local', {method:'POST'}, token); }
      catch { if (epoch === generation) errorText('Signed out on this device. Server session revocation could not be confirmed.'); }
    }
  });
  ui['account-delete'].addEventListener('click', async () => {
    if (!window.confirm('Delete all saved Everwell workspace preferences for this account? Your sign-in account will remain.')) return;
    const epoch = generation; clearTimeout(timer);
    ready = false; present();
    if (writing) await inFlight;
    if (epoch !== generation) return;
    try {
      const token = await accessToken();
      if (epoch !== generation) return;
      await request(query(), {method:'DELETE'}, token);
      if (epoch !== generation) return;
      revision = null; displayName = ''; model.reset(); dirty = false; conflicted = false;
      // Do not immediately recreate a deleted row. A subsequent explicit reload/sign-in creates a fresh one.
      status('Your saved workspace was deleted. Reload saved plan to start a new empty workspace.', 'Workspace deleted');
      present();
    } catch (e) {
      if (epoch !== generation) return;
      ready = true; present(); errorText(message(e)); status('Deletion was not confirmed. Your workspace may still exist.', 'Delete not confirmed');
    }
  });
  window.addEventListener('everwell:change', changed);
  window.addEventListener('beforeunload', e => {
    if (session && (dirty || writing)) { e.preventDefault(); e.returnValue = ''; }
  });
  // Only the signed-in user's JWT is used. No service or provider key is exposed.
  window.EverwellClinicalAPI = Object.freeze({
    user: () => session ? {id:session.user.id,email:session.user.email} : null,
    async read(path) {const token=await accessToken();return request('/rest/v1/'+path,{},token)},
    async rpc(name,body) {const token=await accessToken();return request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body)},token)},
    async analyse(body) {const token=await accessToken();return request('/functions/v1/analyse-blood',{method:'POST',body:JSON.stringify(body)},token)}
  });
  if (!validConfig()) {
    ui['account-form'].hidden = true; ui['account-signedin'].hidden = true;
    ui['account-unavailable'].hidden = false;
    status('Account saving is not configured for this test build.', 'Demo · not saved');
  } else {
    ui['account-unavailable'].hidden = true; present();
    status('Account saving is available. Sign in to load your saved plan.', 'Sign in to save');
  }
})();
