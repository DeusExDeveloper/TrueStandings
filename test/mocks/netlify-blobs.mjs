/*
 * In-memory stand-in for @netlify/blobs used only in tests.
 * Implements the tiny slice of the API the function uses: getStore(name) ->
 * { get(key, {type}), setJSON(key, value) }, plus __resetStore() for tests.
 */
let store = new Map();

export function getStore() {
  return {
    async get(key, opts = {}) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts.type === "json") return JSON.parse(raw);
      return raw;
    },
    async setJSON(key, value) {
      store.set(key, JSON.stringify(value));
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}

export function __resetStore() {
  store = new Map();
}
