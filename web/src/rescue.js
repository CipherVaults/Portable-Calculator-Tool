// Read-only rescue view (plan B3, B18 risk 5). Shown when the engine cannot
// start: no WebAssembly (old browser, iOS Lockdown Mode, a policy), a
// damaged engine file or a failed download. It needs no engine, and it
// only READS: it lists what this app stored on the device, as raw text, and
// offers that raw text unchanged for copying or saving. It never writes,
// clears, migrates or validates anything.
//
// Sources: the app's localStorage keys (prefix "pcalc"). The IndexedDB
// stores join this list when they exist (M3); until then nothing is stored.
(function () {
  "use strict";
  const ns = window.PCalc;
  const PREFIX = "pcalc";
  const FILE_NAME = "portable-calculator-rescue.json";

  // [{source, key, value}] sorted by key, or null when storage is blocked.
  function readStored() {
    const entries = [];
    try {
      const store = window.localStorage;
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key === null || key.slice(0, PREFIX.length) !== PREFIX) continue;
        const value = store.getItem(key);
        entries.push({ source: "localStorage", key, value: value === null ? "" : value });
      }
    } catch (_) {
      return null;
    }
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return entries;
  }

  // The export: every raw value as a string, byte for byte as stored.
  function exportText(entries) {
    return JSON.stringify({ format: "pcalc-rescue", version: 1, entries }, null, 2) + "\n";
  }

  function saveFile(text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = FILE_NAME;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Replaces `container`'s content with the rescue view. `state` is the
  // boot outcome ("unsupported", "integrity", "load-failed"), which picks
  // the title and the explanation.
  function show(container, t, state) {
    const { el } = ns.dom;
    const entries = readStored();
    const note = el("p", { className: "rescue-note", attrs: { role: "status", "aria-live": "polite" } });
    const children = [
      el("h1", { className: "title", text: t("rescue." + state + ".title") }),
      el("p", { className: "status", text: t("rescue." + state + ".body") }),
      el("h2", { className: "rescue-heading", text: t("rescue.heading") }),
      el("p", { className: "status", text: t("rescue.readOnly") })
    ];
    if (entries === null) {
      children.push(el("p", { className: "status", text: t("rescue.blocked") }));
    } else if (entries.length === 0) {
      children.push(el("p", { className: "status", text: t("rescue.empty") }));
    } else {
      children.push(el("p", { className: "status", text: t("rescue.count", { count: entries.length }) }));
      children.push(
        el("ul", { className: "rescue-list" },
          entries.map((entry) =>
            el("li", { className: "rescue-entry" }, [
              el("p", { className: "rescue-key", text: entry.key }),
              el("pre", { className: "rescue-value", text: entry.value })
            ])
          )
        )
      );
      const text = exportText(entries);
      const copy = el("button", { className: "button", text: t("rescue.copy"), attrs: { type: "button" } });
      const save = el("button", { className: "button", text: t("rescue.save"), attrs: { type: "button" } });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          note.textContent = t("rescue.copied");
        } catch (_) {
          note.textContent = t("rescue.copyFailed");
        }
      });
      save.addEventListener("click", () => {
        try {
          saveFile(text);
          note.textContent = t("rescue.saved", { file: FILE_NAME });
        } catch (_) {
          note.textContent = t("rescue.saveFailed");
        }
      });
      children.push(el("div", { className: "button-row" }, [copy, save]));
    }
    children.push(note);
    children.push(el("p", { className: "status", text: t("rescue.oldApps") }));
    const section = el("section", { className: "rescue", attrs: { "data-state": entries === null ? "blocked" : String(entries.length) } }, children);
    section.id = "rescue";
    ns.dom.show(container, [section]);
    return entries === null ? -1 : entries.length;
  }

  ns.rescue = Object.freeze({ show, readStored, exportText });
})();
