/* Optional Supabase cloud integration. Local account storage remains independent. */
(function (global) {
  'use strict';
  const DEFAULT_KEY = 'sb_publishable_Vgs4B-ORk79yYcgrliXe0w_8Lqx-lCj';
  // Replace URL only with the exact project URL.
  const defaults = { url: '', key: DEFAULT_KEY, syncRpc: '' };
  let session = null;
  let refreshing = null;
  async function refreshSession() {
    const old = session;
    if (!old || !old.refreshToken) throw Error('登录已过期，请重新登录。');
    if (!refreshing) refreshing = (async function () {
      const result = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: old.refreshToken }) });
      if (session !== old) throw Error('登录状态已改变，请重新登录。');
      if (!result || !result.access_token || !result.refresh_token) throw Error('登录刷新失败，请重新登录。');
      old.token = result.access_token; old.refreshToken = result.refresh_token; old.expiresAt = Date.now() + (Number(result.expires_in) || 3600)*1000;
    })().finally(function(){ refreshing=null; });
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
    if (global.navigator && global.navigator.onLine === false) throw Error('当前离线，云操作不可用；本地学习和备份不受影响。');
    const c = config(), origin = base();
    const headers = { apikey: c.key, 'Content-Type': 'application/json' };
    if (auth) {
      if (!session || session.origin !== origin) throw Error('请重新登录云账号。');
      if (session.expiresAt && Date.now() >= session.expiresAt - 30000) await refreshSession();
      if (!session || session.origin !== origin) throw Error('请重新登录云账号。');
      headers.Authorization = 'Bearer ' + session.token;
    }
    let response;
    try { response = await fetch(origin + path, Object.assign({ headers: headers, cache: 'no-store' }, options || {})); }
    catch (_) { throw Error('无法连接云服务，请检查网络；本地数据未更改。'); }
    let body = null; try { body = await response.json(); } catch (_) {}
    if (!response.ok) { const error = Error((body && (body.msg || body.message || body.error_description)) || ('云请求失败 (' + response.status + ')')); error.code = body && body.code; throw error; }
    return body;
  }
  async function signIn(email, password) {
    session = null;
    const origin = base();
    const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!result || !result.access_token || !result.user || !result.user.id) throw Error('登录响应无效。');
    session = { token: result.access_token, refreshToken: result.refresh_token || null, expiresAt: Date.now() + (Number(result.expires_in) || 3600)*1000, id: result.user.id, origin: origin };
    try {
      const profiles = await request('/rest/v1/learning_profiles?select=user_id,username&user_id=eq.' + encodeURIComponent(session.id), {}, true);
      if (!Array.isArray(profiles) || profiles.length > 1) throw Error('云账号资料响应无效。');
      let profile = profiles[0];
      if (!profile) {
        let username = result.user.user_metadata && result.user.user_metadata.username;
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
      session.username = profile.username;
      await request('/rest/v1/rpc/record_learning_visit', { method: 'POST', body: '{}' }, true);
      return { id: session.id, username: session.username, origin: origin };
    } catch (e) { session = null; throw e; }
  }
  async function signUp(email, password, username) {
    username = String(username || '').trim();
    if (!username || Array.from(username).length > 20 || /[\x00-\x1f\x7f]/.test(username)) throw Error('用户名须为 1–20 个字符，且不能包含控制字符。');
    await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: { username } }) });
    // Never assume an identity from signup: email confirmation may be required.
    session = null;
  }
  async function readState() {
    if (!session) throw Error('请重新登录云账号。');
    const rows = await request('/rest/v1/learning_states?select=user_id,state,version&user_id=eq.' + encodeURIComponent(session.id), {}, true);
    if (!Array.isArray(rows) || rows.length > 1) throw Error('云端数据响应无效。');
    if (!rows.length) return null;
    const row = rows[0];
    if (row.user_id !== session.id || !Number.isSafeInteger(row.version) || row.version < 0 || !row.state || typeof row.state !== 'object' || Array.isArray(row.state)) throw Error('云端数据或版本无效。');
    return Object.assign({}, row, { data: row.state });
  }
  async function writeState(data, expected) {
    const result = await request('/rest/v1/rpc/save_learning_state', { method: 'POST', body: JSON.stringify({ p_state: data, p_expected_version: expected }) }, true);
    const row = Array.isArray(result) ? (result.length === 1 ? result[0] : null) : result;
    if (!row || !Number.isSafeInteger(row.version) || row.version < 0 || (expected !== null && row.version <= expected)) throw Error('同步冲突或响应无效；请重新读取云端，未进行盲目重试。');
    return row;
  }
  async function visit() { return request('/rest/v1/rpc/record_learning_visit', { method: 'POST', body: '{}' }, true); }
  global.YingyanCloud = { signIn, signUp, readState, writeState, visit, signOut: function () { session = null; }, config: config };
})(window);
