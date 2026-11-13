/* Canonical JSON for parsed JSON values. Object keys use UTF-16 code-unit order. */
(function (root) {
  'use strict';

  function stringify(value) {
    var ancestors = new Set();

    function encode(item) {
      if (item === null) return 'null';
      var type = typeof item;
      if (type === 'string' || type === 'boolean') return JSON.stringify(item);
      if (type === 'number') {
        if (!Number.isFinite(item)) throw new TypeError('Non-finite number is not JSON');
        return JSON.stringify(item);
      }
      if (type !== 'object') throw new TypeError('Value is not JSON');
      if (ancestors.has(item)) throw new TypeError('Circular JSON value');

      var array = Array.isArray(item);
      var proto = Object.getPrototypeOf(item);
      if (!array && proto !== null && Object.getPrototypeOf(proto) !== null) {
        throw new TypeError('Expected a plain JSON object');
      }
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Symbol keys are not JSON');
      ancestors.add(item);
      try {
        var keys = Object.keys(item);
        var names = Object.getOwnPropertyNames(item);
        if (names.length !== keys.length + (array ? 1 : 0)) throw new TypeError('Non-enumerable property is not JSON');
        var parts = [];
        if (array) {
          if (keys.length !== item.length) throw new TypeError('Sparse or extended array is not JSON');
          for (var i = 0; i < item.length; i++) {
            var descriptor = Object.getOwnPropertyDescriptor(item, String(i));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Invalid array entry');
            parts.push(encode(descriptor.value));
          }
          return '[' + parts.join(',') + ']';
        }
        keys.sort();
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var property = Object.getOwnPropertyDescriptor(item, key);
          if (!property || !('value' in property)) throw new TypeError('Accessor is not JSON');
          parts.push(JSON.stringify(key) + ':' + encode(property.value));
        }
        return '{' + parts.join(',') + '}';
      } finally {
        ancestors.delete(item);
      }
    }
    return encode(value);
  }

  root.YingyanCanonical = root.YingyanCanonical || {};
  root.YingyanCanonical.stringify = stringify;
}(window));
