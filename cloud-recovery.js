/* Local recovery copies. No network access and no automatic deletion. */
(function (global) {
  'use strict';
  var DB = 'yingyan-recovery', STORE = 'copies';

  function validAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 1024 || /[\x00-\x1f\x7f]/.test(accountId)) throw new TypeError('Invalid account ID');
  }
  function validId(id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Invalid recovery ID');
  }
  function open() {
    return new Promise(function (resolve, reject) {
      var request, settled = false;
      function fail() { if (!settled) { settled = true; reject(new Error('Recovery storage unavailable')); } }
      try {
        if (!global.indexedDB || typeof global.indexedDB.open !== 'function') return fail();
        request = global.indexedDB.open(DB, 3);
        request.onupgradeneeded = function (event) {
          try {
            var store = event.oldVersion < 1
              ? request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
              : request.transaction.objectStore(STORE);
            if (!store.indexNames.contains('accountId')) store.createIndex('accountId', 'accountId', { unique: false });
            if (!store.indexNames.contains('accountId_id')) store.createIndex('accountId_id', ['accountId', 'id'], { unique: true });
          }
          catch (_) { try { request.transaction.abort(); } catch (_) {} fail(); }
        };
        request.onerror = fail;
        request.onblocked = fail;
        request.onsuccess = function () {
          var db = request.result;
          if (settled) { db.close(); return; }
          settled = true;
          db.onversionchange = function () { db.close(); };
          resolve(db);
        };
      } catch (_) { fail(); }
    });
  }
  function transact(db, mode, operation) {
    return new Promise(function (resolve, reject) {
      var tx, request, result, failed = false;
      function fail() { if (!failed) { failed = true; reject(new Error('Recovery storage operation failed')); } }
      try {
        tx = db.transaction(STORE, mode);
        tx.onabort = fail;
        tx.onerror = fail;
        tx.oncomplete = function () { if (!failed) resolve(result); };
        request = operation(tx.objectStore(STORE));
        request.onsuccess = function () { result = request.result; };
        request.onerror = fail;
      } catch (_) { if (tx) { try { tx.abort(); } catch (_) {} } fail(); }
    });
  }
  async function withDB(fn) {
    var db = await open();
    try { return await fn(db); } finally { db.close(); }
  }
  async function save(accountId, serialized) {
    validAccount(accountId);
    if (typeof serialized !== 'string' || !serialized.length) throw new TypeError('Invalid recovery data');
    return withDB(async function (db) {
      var id = await transact(db, 'readwrite', function (store) {
        return store.add({ accountId: accountId, serialized: serialized, createdAt: Date.now() });
      });
      var copy = await transact(db, 'readonly', function (store) { return store.index('accountId_id').get([accountId, id]); });
      if (!copy || copy.id !== id || copy.accountId !== accountId || copy.serialized !== serialized) throw new Error('Recovery verification failed');
      return id;
    });
  }
  async function list(accountId) {
    validAccount(accountId);
    return withDB(async function (db) {
      var copies = await transact(db, 'readonly', function (store) { return store.index('accountId').getAll(accountId); });
      return copies.map(function (copy) {
        return { id: copy.id, createdAt: copy.createdAt };
      });
    });
  }
  async function read(accountId, id) {
    validAccount(accountId); validId(id);
    return withDB(async function (db) {
      var copy = await transact(db, 'readonly', function (store) { return store.index('accountId_id').get([accountId, id]); });
      return copy && copy.accountId === accountId ? copy.serialized : null;
    });
  }
  global.YingyanRecovery = { save: save, list: list, read: read };
}(window));
