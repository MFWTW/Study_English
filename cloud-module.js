/* Optional Supabase cloud integration. Local account storage remains independent. */
(function (global) {
  'use strict';
  const DEFAULT_KEY = 'sb_publishable_Vgs4B-ORk79yYcgrliXe0w_8Lqx-lCj';
  // Replace URL only with the exact project URL.
  const defaults = { url: '', key: DEFAULT_KEY, syncRpc: '' };
  let session = null;
  let ready = false;
  let refreshing = null;
  let generation = 0;
  const storageKey = 'yingyan.cloud.session.v1';
  // Ownership is the exact value this instance read under the account lock or wrote.
  // Compare before changing it so another tab's replacement is never removed.
  let owned = null;
  let lockClaimed = false;
  function clearStored() {
    try { if (owned !== null && global.localStorage.getItem(storageKey) === owned) global.localStorage.removeItem(storageKey); } catch (_) {}
    owned = null;
  }
  function persist(s, commit) {
    try {
      if (!commit && (owned === null || global.localStorage.getItem(storageKey) !== owned)) return false;
      // Each write has a distinct marker, even when two logins return identical tokens.
      const marker = global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
      const raw = JSON.stringify({ accessToken: s.token, refreshToken: s.refreshToken, expiresAt: s.expiresAt, id: s.id, origin: s.origin, marker: marker });
      global.localStorage.setItem(storageKey, raw); owned = raw; return true;
    } catch (_) { return false; }
  }
  function reset() { generation++; session = null; ready = false; refreshing = null; owned = null; lockClaimed = false; }
  function signOut() { clearStored(); reset(); }
  // peek is an untrusted lock hint only, never proof of authentication.
  function peek() {
    try {
      const saved = JSON.parse(global.localStorage.getItem(storageKey));
      if (!saved || typeof saved.id !== 'string' || !saved.id || saved.origin !== base() || typeof saved.accessToken !== 'string' || !saved.accessToken || typeof saved.refreshToken !== 'string' || !saved.refreshToken || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= 0) return null;
      return { id: saved.id, origin: saved.origin };
    } catch (_) { return null; }
  }
  // Caller must hold the exclusive same-origin account Web Lock.
  function commitSession() {
    if (!session || !ready || session.origin !== base()) throw Error('请重新登录云账号。');
    lockClaimed = true; session.ephemeral=false;
    return persist(session, true);
  }
  async function refreshSession() {
    const old = session;
    // A freshly authenticated, unshared session can refresh before its lock is
    // acquired; a restored/shared session must already hold the account lock.
    if (!lockClaimed && !(old && old.ephemeral)) throw Error('请先持有账号锁并提交会话。');
    if (!old || !old.refreshToken) throw Error('登录已过期，请重新登录。');
    if (!refreshing) {
      const task = (async function () {
        try {
          if (base() !== old.origin) throw Error('云服务地址已改变，请重新登录。');
          const result = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: old.refreshToken }) });
          if (session !== old) throw Error('登录状态已改变，请重新登录。');
          if (!result || !result.access_token || !result.refresh_token || !result.user || result.user.id !== old.id) throw Error('登录刷新身份无效，请重新登录。');
          old.token = result.access_token; old.refreshToken = result.refresh_token; old.expiresAt = Date.now() + (Number(result.expires_in) || 3600)*1000;
          if(lockClaimed && !persist(old)){
            clearStored();
            try { if(typeof global.dispatchEvent==='function' && typeof global.Event==='function') global.dispatchEvent(new global.Event('yingyan-session-save-failed')); } catch (_) {}
          }
        } catch (error) { if (session === old && !error.network) signOut(); throw error; }
      })();
      refreshing = task;
      task.finally(function () { if (refreshing === task) refreshing = null; }).catch(function () {});
    }
    return refreshing;
  }
  function config() { return Object.assign({}, defaults, global.YINGYAN_CLOUD_CONFIG || {}); }
  function base() {
    const c = config(); let u;
    try { u = new URL(c.url); } catch (_) { throw Error('云服务尚未配置：请填写准确的 Supabase 项目 URL。'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('项目 URL 必须是 HTTPS 源地址。');
    if (!c.key || !/^sb_publishable_/.test(c.key)) throw Error('请配置 Supabase publishable key，不能使用 service role key。');
    return u.origin;
  }
  async function request(path, options, auth) {
    if (global.navigator && global.navigator.onLine === false) { const error=Error('当前离线，云操作不可用；本地学习和备份不受影响。'); error.network=true; throw error; }
    const c = config(), origin = base();
    const headers = { apikey: c.key, 'Content-Type': 'application/json' };
    if (auth) {
      if (!session || session.origin !== origin) throw Error('请重新登录云账号。');
      if (session.expiresAt && Date.now() >= session.expiresAt - 30000) await refreshSession();
      if (!session || session.origin !== origin) throw Error('请重新登录云账号。');
      headers.Authorization = 'Bearer ' + session.token;
    }
    let response, body=null, timer=null, controller=null;
    const requestOptions=Object.assign({ headers: headers, cache: 'no-store' }, options || {});
    if(typeof AbortController==='function' && !requestOptions.signal){ controller=new AbortController(); requestOptions.signal=controller.signal; }
    const work=(async function(){
      const result=await fetch(origin+path,requestOptions); let decoded=null;
      try { decoded=await result.json(); } catch(e){ if(controller && controller.signal.aborted) throw e; }
      return {response:result,body:decoded};
    })();
    try {
      let result;
      if(typeof setTimeout==='function'){
        const timeout=new Promise(function(_,reject){timer=setTimeout(function(){ if(controller) controller.abort(); reject(Error('timeout')); },20000);});
        result=await Promise.race([work,timeout]);
      } else result=await work;
      response=result.response; body=result.body;
    } catch (_) { const error=Error('无法连接云服务或请求超时，请检查网络；本地数据未更改。'); error.network=true; throw error; }
    finally { if(timer!==null) clearTimeout(timer); }
    if (!response.ok) { const error = Error((body && (body.msg || body.message || body.error_description)) || ('云请求失败 (' + response.status + ')')); error.code = body && body.code; error.status=response.status; if([408,425,429,499].includes(response.status) || response.status>=500) error.network=true; throw error; }
    return body;
  }
  async function signIn(email, password) {
    reset();
    const epoch = generation, origin = base();
    const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (epoch !== generation) throw Error('登录状态已改变，请重新登录。');
    if (!result || !result.access_token || !result.refresh_token || !result.user || !result.user.id) throw Error('登录响应无效。');
    session = { token: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + (Number(result.expires_in) || 3600)*1000, id: result.user.id, origin: origin, ephemeral:true };
    return completeLogin(result.user, epoch);
  }
  async function completeLogin(user, epoch) {
    const current = session, origin = current.origin;
    try {
      const profiles = await request('/rest/v1/learning_profiles?select=user_id,username&user_id=eq.' + encodeURIComponent(current.id), {}, true);
      if (session !== current || generation !== epoch) throw Error('登录状态已改变，请重新登录。');
      if (!Array.isArray(profiles) || profiles.length > 1) throw Error('云账号资料响应无效。');
      let profile = profiles[0];
      if (!profile) {
        let username = user.user_metadata && user.user_metadata.username;
        if (typeof username !== 'string' || !username.trim()) throw Error('云账号缺少用户名，请联系管理员。');
        for (;;) {
          try {
            const initialized = await request('/rest/v1/rpc/initialize_learning_account', { method: 'POST', body: JSON.stringify({ p_username: username }) }, true);
            profile = Array.isArray(initialized) && initialized.length === 1 ? initialized[0] : null;
            break;
          } catch (error) {
            if (error.code !== '23505' || typeof global.prompt !== 'function') throw error;
            username = global.prompt('用户名已被使用，请输入新的用户名（1–20 字符）：');
            if (username === null) throw Error('尚未设置用户名，请重新登录后设置。');
            username = username.trim();
            if (!username || Array.from(username).length > 20 || /[\x00-\x1f\x7f]/.test(username)) throw Error('用户名格式无效，请重新登录设置。');
          }
        }
      } else if (profile.user_id !== session.id) {
        throw Error('云账号资料响应无效。');
      }
      if (!profile || typeof profile.username !== 'string' || !profile.username) throw Error('云账号资料尚未就绪，请联系管理员检查唯一用户名配置。');
      if (session !== current || generation !== epoch) throw Error('登录状态已改变，请重新登录。');
      current.username = profile.username;
      await request('/rest/v1/rpc/record_learning_visit', { method: 'POST', body: '{}' }, true);
      if (session !== current || generation !== epoch) throw Error('登录状态已改变，请重新登录。');
      ready = true;
      return { id: current.id, username: current.username, origin: origin };
    } catch (e) { if (session === current) { session = null; ready = false; if (!e.network) clearStored(); } throw e; }
  }
  async function restore(expectedHint) {
    // Caller must first obtain the exclusive account lock indicated by peek().
    reset(); const epoch = generation;
    let saved, raw;
    try { raw = global.localStorage.getItem(storageKey); if (!raw) return null; saved = JSON.parse(raw); }
    catch (_) { return null; }
    const origin = base();
    if (!saved || saved.origin !== origin || typeof saved.id !== 'string' || !saved.id || typeof saved.accessToken !== 'string' || !saved.accessToken || typeof saved.refreshToken !== 'string' || !saved.refreshToken || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= 0) return null;
    if (expectedHint && (saved.id !== expectedHint.id || saved.origin !== expectedHint.origin)) throw Error('登录状态发生变化，请重新打开网站。');
    owned = raw; lockClaimed = true;
    const current = session = { token: saved.accessToken, refreshToken: saved.refreshToken, expiresAt: saved.expiresAt, id: saved.id, origin: origin };
    try {
      if (Date.now() >= current.expiresAt - 30000) await refreshSession();
      if (session !== current || generation !== epoch || base() !== origin) throw Error('登录状态已改变，请重新登录。');
      const user = await request('/auth/v1/user', { headers: { apikey: config().key, 'Content-Type': 'application/json', Authorization: 'Bearer ' + current.token } });
      if (session !== current || generation !== epoch) throw Error('登录状态已改变，请重新登录。');
      if (!user || user.id !== current.id) throw Error('云账号身份校验失败。');
      return await completeLogin(user, epoch);
    } catch (e) { if (session === current) { session = null; ready = false; if (!e.network) clearStored(); } throw e; }
  }
  async function signUp(email, password, username) {
    username = String(username || '').trim();
    if (!username || Array.from(username).length > 20 || /[\x00-\x1f\x7f]/.test(username)) throw Error('用户名须为 1–20 个字符，且不能包含控制字符。');
    signOut();
    await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: { username } }) });
    // Signup never establishes a session; confirmation may be required.
  }
  async function readState() {
    if (!session || !ready) throw Error('请重新登录云账号。');
    const current=session;
    const rows = await request('/rest/v1/learning_states?select=user_id,state,version&user_id=eq.' + encodeURIComponent(current.id), {}, true);
    if (session!==current || !ready) throw Error('登录状态已改变，请重新登录。');
    if (!Array.isArray(rows) || rows.length > 1) throw Error('云端数据响应无效。');
    if (!rows.length) return null;
    const row = rows[0];
    if (row.user_id !== current.id || !Number.isSafeInteger(row.version) || row.version < 0 || !row.state || typeof row.state !== 'object' || Array.isArray(row.state)) throw Error('云端数据或版本无效。');
    return Object.assign({}, row, { data: row.state });
  }
  async function readVersion() {
    if (!session || !ready) throw Error('请重新登录云账号。');
    const current=session;
    const rows=await request('/rest/v1/learning_states?select=user_id,version&user_id=eq.'+encodeURIComponent(current.id),{},true);
    if(session!==current || !ready || !Array.isArray(rows) || rows.length!==1 || rows[0].user_id!==current.id || !Number.isSafeInteger(rows[0].version) || rows[0].version<0) throw Error('云端版本响应无效。');
    return rows[0].version;
  }
  async function writeState(data, expected) {
    if (!session || !ready) throw Error('请重新登录云账号。');
    const current=session;
    const result = await request('/rest/v1/rpc/save_learning_state', { method: 'POST', body: JSON.stringify({ p_state: data, p_expected_version: expected }) }, true);
    if(session!==current || !ready) throw Error('登录状态已改变，云端结果需要重新确认。');
    const row = Array.isArray(result) ? (result.length === 1 ? result[0] : null) : result;
    if (!row || !Number.isSafeInteger(row.version) || row.version < 0 || (expected !== null && row.version <= expected)) { const error=Error('云端响应不完整，将先确认同步结果。'); error.uncertain=true; throw error; }
    return row;
  }
  async function visit() { if (!session || !ready) throw Error('请重新登录云账号。'); return request('/rest/v1/rpc/record_learning_visit', { method: 'POST', body: '{}' }, true); }
  global.YingyanCloud = { signIn, signUp, peek, commitSession, restore, readState, readVersion, writeState, visit, signOut, abandon:reset, config: config };
})(window);
