// The ± key (plan B16; the owner: phones first). The iPhone decimal and
// number keypads have no minus key, so every numeric field that accepts a
// negative value gets a ± button beside it (a 44 px target, labelled for
// screen readers). It flips the sign of the field's text, whatever its
// digits (Western or Arabic-Indic), and tells the tool as typing would (an
// input event). The field keeps inputmode="decimal" (or "numeric"). A tap
// while the field has focus keeps the focus, and so the on-screen
// keyboard, in the field.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el } = ns.dom;

  // "-12" -> "12", "12" -> "-12", "+12" -> "-12", "" -> "-", "−٥" -> "٥".
  function flip(text) {
    const s = String(text || "").replace(/^\s+/, "");
    if (/^[-\u2212]/.test(s)) return s.slice(1);
    if (s.startsWith("+")) return "-" + s.slice(1);
    return "-" + s;
  }

  // `input` (with an id) beside its ± button; `label` names the button.
  function wrap(input, label) {
    const id = input.getAttribute("id");
    const button = el("button", { className: "button sign-button", text: "±", attrs: { type: "button", id: id + "Sign", "aria-label": label, "aria-controls": id } });
    const keep = (e) => {
      if (document.activeElement === input) e.preventDefault();
    };
    button.addEventListener("pointerdown", keep);
    button.addEventListener("mousedown", keep);
    button.addEventListener("click", () => {
      const focused = document.activeElement === input;
      const before = input.value;
      const at = focused && typeof input.selectionStart === "number" ? input.selectionStart : null;
      const end = focused && typeof input.selectionEnd === "number" ? input.selectionEnd : null;
      input.value = flip(before);
      // The caret stays by the same digit: moved by the sign added or
      // removed in front of it (the leading text the flip trims is gone).
      if (at !== null && end !== null && typeof input.setSelectionRange === "function") {
        const shift = input.value.length - before.length;
        const max = input.value.length;
        const place = (p) => Math.min(max, Math.max(0, p + shift));
        try {
          input.setSelectionRange(place(at), place(end));
        } catch (_) {
          // A field type without a selection: the caret is the browser's.
        }
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return el("div", { className: "signed-row" }, [input, button]);
  }

  ns.signToggle = Object.freeze({ wrap, flip });
})();
