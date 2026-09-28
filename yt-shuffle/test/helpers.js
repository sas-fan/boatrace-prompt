'use strict';
// Node でライブラリを読み込むための準備（chrome.storage のインメモリ版を用意する）

function makeFakeChrome() {
  const data = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const local = {
    _data: data,
    async get(keys) {
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data[k] = clone(v);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    async getKeys() {
      return Object.keys(data);
    },
  };
  return {
    storage: { local, onChanged: { addListener() {} } },
    runtime: {
      async sendMessage() {
        throw new Error('no background in tests');
      },
      getManifest: () => ({ version: 'test' }),
    },
  };
}

function loadLibs() {
  globalThis.chrome = makeFakeChrome();
  globalThis.YTS = {};
  for (const f of ['util', 'extract', 'rss', 'takeout', 'store', 'recommend']) {
    delete require.cache[require.resolve(`../extension/lib/${f}.js`)];
    require(`../extension/lib/${f}.js`);
  }
  globalThis.YTS.isBackground = true;
  return globalThis.YTS;
}

module.exports = { makeFakeChrome, loadLibs };
