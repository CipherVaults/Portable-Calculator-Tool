// Unsafe-location rules (plan B1, B3, B14). check-unsafe.mjs applies them to
// the tree; scripts/safety-eval.mjs (slice D) proves each fires.
//
// Like web-hygiene.mjs, the scan is over the RAW lines: an earlier version
// cut each line at the first `//`, which also cut a `"http://…"` string and
// hid an `unsafe {` after it on the same line. No Rust file may write the
// unsafe keyword in that form anywhere, comments included ("unsafe code" is
// fine; the keyword followed by a brace, fn, impl, trait or extern is not).

export const UNSAFE_USE = /\bunsafe\s*(\{|fn\b|impl\b|trait\b|extern\b)/;
export const EXPECTED_WASM_EXPORTS = 4;

// An attribute line (not a comment) that allows or expects unsafe_code,
// including the crate-level and cfg_attr forms.
const ALLOW_ATTR = /^\s*#\s*!?\s*\[.*\b(allow|expect)\s*\([^)]*\bunsafe_code\b/;

export function forbidRootProblems(rel, text) {
  return /^#!\[forbid\(unsafe_code\)\]\s*$/m.test(text) ? [] : [`${rel}: missing #![forbid(unsafe_code)]`];
}

// pcalc-wasm: #![deny(unsafe_code)], and each #[allow(unsafe_code)] sits
// directly on an #[unsafe(no_mangle)] export attribute.
export function wasmRootProblems(rel, text, expected = EXPECTED_WASM_EXPORTS) {
  const problems = [];
  const lines = text.split("\n");
  if (!lines.some((l) => l.trim() === "#![deny(unsafe_code)]")) problems.push(`${rel}: missing #![deny(unsafe_code)]`);
  let allows = 0;
  lines.forEach((line, i) => {
    if (ALLOW_ATTR.test(line)) {
      allows++;
      if (line.trim() !== "#[allow(unsafe_code)]" || (lines[i + 1] || "").trim() !== "#[unsafe(no_mangle)]") {
        problems.push(`${rel}:${i + 1}: #[allow(unsafe_code)] not directly on #[unsafe(no_mangle)]`);
      }
    }
  });
  if (allows !== expected) problems.push(`${rel}: expected ${expected} allowed exports, found ${allows}`);
  return { problems, allows };
}

// Any Rust file: no unsafe block, fn, impl, trait or extern block, and no
// allow(unsafe_code) attribute outside pcalc-wasm's root.
export function rustSourceProblems(rel, text, { allowUnsafeAttr = false } = {}) {
  const problems = [];
  text.split("\n").forEach((line, i) => {
    if (UNSAFE_USE.test(line)) problems.push(`${rel}:${i + 1}: unsafe code`);
    if (!allowUnsafeAttr && ALLOW_ATTR.test(line)) problems.push(`${rel}:${i + 1}: allow(unsafe_code) outside pcalc-wasm`);
  });
  return problems;
}
