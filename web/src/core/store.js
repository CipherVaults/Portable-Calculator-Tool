// The web document store (plan B10, B11): settings, state, history and
// countdowns in IndexedDB (database "pcalc", object store "docs", key = the
// document name), with exactly the outcomes of the desktop store
// (crates/pcalc-store/src/docs.rs). Every load and save is decided by the
// engine's <name>.validate op:
//
//   no entry                         empty       writable
//   the read fails                   unreadable  read-only, untouched
//   request_too_large                tooLarge    read-only, untouched (never corrupt)
//   status "newer"                   newer       read-only, untouched, no backup
//   invalid_request (or not text)    corrupt     backup first, then read-only
//   the engine cannot answer         unvalidated read-only, untouched
//   status "ok"                      ok          writable; the canonical document
//
// Read-only documents refuse save() with "read_only" until a successful
// reload ("Retry") or an explicit clear() ("Start fresh", which backs the
// old value up first; a newer document is never cleared). A save or clear
// of a document this store has not loaded yet loads it first, so nothing
// unseen (corrupt, newer, too large) is ever overwritten. Backups are "<name>.bak.1" (newest) to ".bak.3",
// rotated in one transaction; a backup equal to the newest is not repeated.
// Each document write is one put in its own transaction (atomic). After a
// write, a BroadcastChannel("pcalc") notice "<name>-changed" tells the other
// tabs to reload it.
//
// Without IndexedDB (some private modes, a blocked database) the store
// runs in memory and the shell shows a banner: nothing is saved.
(function () {
  "use strict";
  const ns = window.PCalc;
  const DB_NAME = "pcalc";
  const DB_VERSION = 1;
  const STORE = "docs";
  const BACKUPS = 3;
  const OPEN_TIMEOUT_MS = 4000;
  // Largest canonical document written (bytes of UTF-8), as on the desktop.
  const DOCS = Object.freeze({
    settings: { op: "settings.validate", writeCap: 64 * 1024 },
    state: { op: "state.validate", writeCap: 256 * 1024 },
    history: { op: "history.validate", writeCap: 4 * 1024 * 1024 },
    countdowns: { op: "countdowns.validate", writeCap: 64 * 1024 }
  });
  const NAMES = Object.freeze(Object.keys(DOCS));

  const request = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
    });

  // A failed request's error event bubbles to the transaction before the
  // transaction aborts, so tx.error is still null in onerror: the cause
  // (such as a QuotaExceededError) is on the event's target, the request.
  const done = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject((e && e.target && e.target.error) || tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });

  // ---- backends: get / put / del / rotate --------------------------------

  // Opens the database; resolves null when IndexedDB is missing, refused,
  // blocked or too slow (the caller then uses memory).
  function openIdb(idb) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
      let req;
      try {
        if (!idb || typeof idb.open !== "function") return finish(null);
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (_) {
        return finish(null);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close();
          return;
        }
        // Another tab upgrading later must not be blocked by this one.
        db.onversionchange = () => db.close();
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    });
  }

  function idbBackend(db) {
    const tx = (mode) => db.transaction(STORE, mode);
    return {
      kind: "indexeddb",
      async get(key) {
        const t = tx("readonly");
        const value = await request(t.objectStore(STORE).get(key));
        return value === undefined ? { found: false } : { found: true, value };
      },
      async put(key, value) {
        const t = tx("readwrite");
        t.objectStore(STORE).put(value, key);
        await done(t);
      },
      async del(key) {
        const t = tx("readwrite");
        t.objectStore(STORE).delete(key);
        await done(t);
      },
      // One transaction: .bak.3 = .bak.2, .bak.2 = .bak.1, .bak.1 = entry.
      async rotate(name, entry, same) {
        const t = tx("readwrite");
        const s = t.objectStore(STORE);
        const keys = Array.from({ length: BACKUPS }, (_, i) => name + ".bak." + (i + 1));
        const olds = await Promise.all(keys.map((k) => request(s.get(k))));
        if (olds[0] !== undefined && same(olds[0])) {
          await done(t);
          return false;
        }
        for (let i = BACKUPS - 1; i > 0; i--) if (olds[i - 1] !== undefined) s.put(olds[i - 1], keys[i]);
        s.put(entry, keys[0]);
        await done(t);
        return true;
      }
    };
  }

  function memoryBackend() {
    const map = new Map();
    return {
      kind: "memory",
      async get(key) {
        return map.has(key) ? { found: true, value: map.get(key) } : { found: false };
      },
      async put(key, value) {
        map.set(key, value);
      },
      async del(key) {
        map.delete(key);
      },
      async rotate(name, entry, same) {
        const keys = Array.from({ length: BACKUPS }, (_, i) => name + ".bak." + (i + 1));
        if (map.has(keys[0]) && same(map.get(keys[0]))) return false;
        for (let i = BACKUPS - 1; i > 0; i--) if (map.has(keys[i - 1])) map.set(keys[i], map.get(keys[i - 1]));
        map.set(keys[0], entry);
        return true;
      }
    };
  }

  // ---- the documents -------------------------------------------------------

  const utf8Length = (text) => new TextEncoder().encode(text).length;

  // Structured-clone equality is not needed: backups hold raw values, and
  // two raws are "the same" when they are equal strings or serialise alike.
  function sameRaw(a, b) {
    if (typeof a === "string" || typeof b === "string") return a === b;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (_) {
      return false;
    }
  }

  // engine(op, req) -> envelope text; bus: PCalc.bus (or null); now(): ms.
  function createDocStore(backend, engine, bus, now) {
    const readOnly = new Map();
    const loaded = new Set();
    const clock = now || (() => Date.now());

    function outcome(name, status, extra) {
      const o = Object.assign({ name, status, readOnly: !(status === "empty" || status === "ok"), doc: null, schemaVersion: null, backup: null, field: null }, extra || {});
      loaded.add(name);
      if (o.readOnly) readOnly.set(name, status);
      else readOnly.delete(name);
      return o;
    }

    async function validate(name, text) {
      try {
        return JSON.parse(await engine(DOCS[name].op, text));
      } catch (_) {
        return null;
      }
    }

    async function backup(name, raw) {
      const entry = { atMs: clock(), raw };
      const wrote = await backend.rotate(name, entry, (old) => old && sameRaw(old.raw, raw));
      return wrote ? name + ".bak.1" : null;
    }

    async function load(name) {
      if (!Object.prototype.hasOwnProperty.call(DOCS, name)) throw new Error("unknown document: " + name);
      let got;
      try {
        got = await backend.get(name);
      } catch (_) {
        return outcome(name, "unreadable");
      }
      if (!got.found) return outcome(name, "empty");
      const raw = got.value;
      if (typeof raw !== "string") {
        let b = null;
        try {
          b = await backup(name, raw);
        } catch (_) {
          b = null;
        }
        return outcome(name, "corrupt", { backup: b });
      }
      const env = await validate(name, raw);
      if (env === null || (env.ok !== "true" && env.ok !== "false")) return outcome(name, "unvalidated");
      if (env.ok === "true") {
        const r = env.result;
        if (r.status === "ok") return outcome(name, "ok", { doc: JSON.stringify(r.doc) });
        if (r.status === "newer") return outcome(name, "newer", { schemaVersion: r.schemaVersion });
        return outcome(name, "unvalidated");
      }
      const code = env.error && env.error.code;
      if (code === "request_too_large") return outcome(name, "tooLarge");
      if (code !== "invalid_request") return outcome(name, "unvalidated");
      // Corrupt: the backup first; whatever happens to it, the value stays.
      let b = null;
      try {
        b = await backup(name, raw);
      } catch (_) {
        b = null;
      }
      return outcome(name, "corrupt", { backup: b, field: env.error.field === undefined ? null : env.error.field });
    }

    // -> {ok: true, text} or {ok: false, code: read_only|invalid|too_large|quota|write_failed}
    async function save(name, text) {
      if (!Object.prototype.hasOwnProperty.call(DOCS, name)) return { ok: false, code: "unknown_doc" };
      if (!loaded.has(name)) await load(name);
      if (readOnly.has(name)) return { ok: false, code: "read_only" };
      const env = await validate(name, String(text));
      if (env === null) return { ok: false, code: "invalid" };
      if (env.ok !== "true") return { ok: false, code: env.error && env.error.code === "request_too_large" ? "too_large" : "invalid" };
      if (env.result.status !== "ok") return { ok: false, code: "invalid" };
      const canonical = JSON.stringify(env.result.doc);
      if (utf8Length(canonical) > DOCS[name].writeCap) return { ok: false, code: "too_large" };
      try {
        await backend.put(name, canonical);
      } catch (err) {
        return { ok: false, code: err && err.name === "QuotaExceededError" ? "quota" : "write_failed" };
      }
      if (bus) bus.post(name + "-changed");
      return { ok: true, text: canonical };
    }

    // "Start fresh" (the UI confirms first): backs the stored value up,
    // removes it and makes the document writable. Refused when the backup
    // cannot be written, so nothing is ever removed unsaved, and for a
    // document written by a newer app (never written, never backed up).
    async function clear(name) {
      if (!Object.prototype.hasOwnProperty.call(DOCS, name)) return { ok: false, code: "unknown_doc" };
      if (!loaded.has(name)) await load(name);
      if (readOnly.get(name) === "newer") return { ok: false, code: "read_only" };
      let got;
      try {
        got = await backend.get(name);
      } catch (_) {
        return { ok: false, code: "unreadable" };
      }
      let b = null;
      if (got.found) {
        if (typeof got.value === "string") {
          const env = await validate(name, got.value);
          if (env && env.ok === "true" && env.result && env.result.status === "newer") {
            // A newer app replaced it since the last load.
            readOnly.set(name, "newer");
            return { ok: false, code: "read_only" };
          }
        }
        try {
          b = await backup(name, got.value);
          await backend.del(name);
        } catch (_) {
          return { ok: false, code: "write_failed" };
        }
      }
      readOnly.delete(name);
      if (bus) bus.post(name + "-changed");
      return { ok: true, backup: b };
    }

    return Object.freeze({
      kind: backend.kind,
      load,
      save,
      clear,
      isReadOnly: (name) => readOnly.has(name)
    });
  }

  // The browser's store: IndexedDB, else memory.
  async function openWebStore(engine, bus) {
    let db = null;
    try {
      db = await openIdb(window.indexedDB);
    } catch (_) {
      db = null;
    }
    return createDocStore(db ? idbBackend(db) : memoryBackend(), engine, bus);
  }

  // navigator.storage.persist() / estimate(), where they exist.
  async function persist() {
    try {
      if (!navigator.storage || typeof navigator.storage.persist !== "function") return null;
      if (typeof navigator.storage.persisted === "function" && (await navigator.storage.persisted())) return true;
      return Boolean(await navigator.storage.persist());
    } catch (_) {
      return null;
    }
  }

  async function estimate() {
    try {
      if (!navigator.storage || typeof navigator.storage.estimate !== "function") return null;
      const e = await navigator.storage.estimate();
      return { usage: Number(e.usage) || 0, quota: Number(e.quota) || 0 };
    } catch (_) {
      return null;
    }
  }

  ns.store = Object.freeze({
    DB_NAME, STORE, NAMES, DOCS, BACKUPS,
    createDocStore, memoryBackend, idbBackend, openIdb, openWebStore, persist, estimate
  });
})();
