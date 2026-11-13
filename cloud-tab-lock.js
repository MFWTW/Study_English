/* Web Locks are cooperative: older tabs that do not use this lock cannot be stopped. */
(function (global) {
  'use strict';

  function acquire(accountId) {
    return new Promise(function (resolve, reject) {
      var settled = false, finishHold, request;
      if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 1024 || /[\x00-\x1f\x7f]/.test(accountId)) {
        reject(new TypeError('Invalid account ID'));
        return;
      }
      function fail(error) {
        if (!settled) { settled = true; reject(error); }
      }
      try {
        var locks = global.navigator && global.navigator.locks;
        if (!locks || typeof locks.request !== 'function') {
          fail(new Error('Web Locks API unavailable'));
          return;
        }
        request = locks.request('yingyan-cloud-account:' + accountId, { mode: 'exclusive', ifAvailable: true }, function (lock) {
          if (!lock) {
            fail(new Error('Account is already locked by another tab'));
            return;
          }
          if (settled) return;
          var hold = new Promise(function (done) { finishHold = done; });
          var released = false;
          // Defer delivery so a synchronous request() failure cannot report success.
          Promise.resolve().then(function () {
            if (settled) { finishHold(); return; }
            settled = true;
            resolve(function release() {
              if (!released) { released = true; finishHold(); }
              // Wait for the browser's request to settle before attempting reacquisition.
              return completion;
            });
          });
          return hold;
        });
        var completion = Promise.resolve(request).then(function () {
          if (!settled) fail(new Error('Web Locks request ended without acquiring a lock'));
        }, function (error) {
          fail(error instanceof Error ? error : new Error('Web Locks request failed'));
        });
      } catch (error) {
        // If a nonconforming implementation invoked the callback before throwing,
        // release any lock it may have granted.
        if (finishHold) finishHold();
        fail(error instanceof Error ? error : new Error('Web Locks API unavailable'));
      }
    });
  }

  global.YingyanTabLock = { acquire: acquire };
}(window));
