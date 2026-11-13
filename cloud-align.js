/* Cloud-first local replacement. The caller validates remoteState and its schema.
 * normalize(state), hash(serialized), and makeToken() may be asynchronous.
 * recovery.save(accountId, raw) returns an id; recovery.read(accountId, id)
 * must return the exact saved string. Recovery copies are never deleted here.
 * A pendingRestore marker means interrupted recovery: back up any remaining
 * local state again and retry the cloud-first replacement, never upload it.
 * localStorage has no cross-tab compare-and-swap: checks cannot make this
 * protocol atomic against old tabs or other writers that ignore the marker.
 */
(function (global) {
  'use strict';
  async function replace(options) {
    if (!options || typeof options !== 'object') throw new TypeError('Invalid options');
    var o = options, id = o.accountId;
    if (typeof id !== 'string' || !id.trim() || id.length > 1024 || /[\x00-\x1f\x7f]/.test(id)) throw new TypeError('Invalid account ID');
    if (o.expectedLocal !== null && typeof o.expectedLocal !== 'string') throw new TypeError('Invalid expected local state');
    if (o.expectedMeta !== null && typeof o.expectedMeta !== 'string') throw new TypeError('Invalid expected metadata');
    if (!Number.isSafeInteger(o.remoteVersion) || o.remoteVersion < 0) throw new TypeError('Invalid remote version');
    if (!o.remoteState || typeof o.remoteState !== 'object' || Array.isArray(o.remoteState)) throw new TypeError('Invalid remote state');
    if (typeof o.normalize !== 'function' || typeof o.hash !== 'function' || typeof o.makeToken !== 'function') throw new TypeError('Invalid callback');
    if (!o.storage || typeof o.storage.getItem !== 'function' || typeof o.storage.setItem !== 'function') throw new TypeError('Invalid storage');
    if (!o.recovery || typeof o.recovery.save !== 'function' || typeof o.recovery.read !== 'function') throw new TypeError('Invalid recovery');
    var storage = o.storage, recovery = o.recovery, normalize = o.normalize, hash = o.hash, makeToken = o.makeToken;
    var version = o.remoteVersion, remoteState = o.remoteState;
    var key = 'ciyan_account_state_v1_' + id, metaKey = 'ciyan_cloud_sync_v1_' + id;
    var expectedLocal = o.expectedLocal, expectedMeta = o.expectedMeta;
    function check(local, meta) {
      if ((typeof o.guard === 'function' && !o.guard()) || storage.getItem(key) !== local || storage.getItem(metaKey) !== meta) {
        var error=new Error('Local state, metadata or session changed'); error.code='ALIGN_CHANGED'; throw error;
      }
    }
    check(expectedLocal, expectedMeta);
    if (expectedMeta !== null) {
      var previous;
      try { previous = JSON.parse(expectedMeta); } catch (_) { throw new Error('Invalid local metadata'); }
      if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Invalid local metadata');
      if (previous.pendingRestore && expectedLocal === null && previous.hadLocal !== false) throw new Error('Interrupted recovery has no local state');
    }
    var state = await normalize(remoteState);
    check(expectedLocal, expectedMeta);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Invalid normalized state');
    var serialized = JSON.stringify(state);
    if (typeof serialized !== 'string') throw new TypeError('State is not serializable');
    var cleanHash = await hash(serialized);
    check(expectedLocal, expectedMeta);
    if (typeof cleanHash !== 'string' || !cleanHash || cleanHash.length > 1024) throw new TypeError('Invalid hash');
    var token = await makeToken();
    check(expectedLocal, expectedMeta);
    if (typeof token !== 'string' || !token || token.length > 256) throw new TypeError('Invalid restore token');
    if (expectedLocal !== null && (expectedLocal !== serialized || (previous && previous.pendingRestore))) {
      var backupId = await recovery.save(id, expectedLocal);
      check(expectedLocal, expectedMeta);
      if (backupId === null || backupId === undefined) throw new Error('Invalid recovery ID');
      var saved = await recovery.read(id, backupId);
      check(expectedLocal, expectedMeta);
      if (saved !== expectedLocal) throw new Error('Recovery verification failed');
    }
    var pending = JSON.stringify({ pendingRestore: true, restoreToken: token, hadLocal: expectedLocal !== null });
    var clean = JSON.stringify({ version: version, dirty: false, cleanHash: cleanHash, pendingRestore: false, restoreToken: null });
    check(expectedLocal, expectedMeta);
    storage.setItem(metaKey, pending);
    check(expectedLocal, pending);
    storage.setItem(key, serialized);
    check(serialized, pending);
    storage.setItem(metaKey, clean);
    check(serialized, clean);
    return { state: state, serialized: serialized, version: version, cleanHash: cleanHash, backupId: backupId || null };
  }
  global.YingyanAlign = { replace: replace };
}(window));
