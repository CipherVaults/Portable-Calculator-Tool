// Static hygiene rules for the web sources (plan B3, B16). build-web.mjs
// applies them before assembling anything; scripts/safety-eval.mjs (slice D)
// proves each rule fires on a violating input.
//
// The rules scan the RAW text, comments included. An earlier version
// stripped `//` comments with a regex first, and that regex also removed
// everything after a `//` inside a string literal (`x = "a//"; el.innerHTML
// = y;` passed). A banned name may therefore not appear anywhere in a
// source file, not even in a comment: say "HTML sinks" or "inline styles".
//
// Each function returns a list of problem strings (empty = clean).

export const JS_BANS = [
  [/\binnerHTML\b/, "innerHTML"],
  [/\bouterHTML\b/, "outerHTML"],
  [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"],
  [/\bdocument\s*\.\s*write(ln)?\b/, "document.write"],
  [/\beval\s*\(/, "eval("],
  [/[,(]\s*eval\s*\)/, "indirect eval"],
  [/\bnew\s+Function\b/, "new Function"],
  [/(^|[^\w$.])Function\s*\(/m, "Function("],
  [/\bset(Timeout|Interval)\s*\(\s*["'`]/, "string timer (eval)"],
  [/\.\s*style\b/, ".style (toggle classes instead)"],
  [/\[\s*["'`]style["'`]\s*\]/, '["style"]'],
  [/setAttribute(NS)?\s*\([^)]*["'`]style["'`]/, 'setAttribute("style")'],
  [/\bcssText\b/, "cssText"]
];

// Hex colours, rgb()/hsl() and friends.
export const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

// The only file that may hold raw colour values.
export const TOKENS_FILE = "styles/tokens.css";

export function lineEndingProblems(rel, text) {
  return text.includes("\r") ? [`${rel} has CR characters; LF only (see .gitattributes)`] : [];
}

export function scriptProblems(rel, text) {
  const problems = [];
  for (const [re, name] of JS_BANS) {
    if (re.test(text)) problems.push(`${rel}: forbidden ${name}`);
  }
  if (/<\/script/i.test(text)) problems.push(`${rel}: contains </script`);
  return problems;
}

export function styleProblems(rel, text) {
  const problems = [];
  if (rel !== TOKENS_FILE) {
    const m = text.match(COLOUR_LITERAL);
    if (m) problems.push(`${rel}: raw colour literal ${m[0]} (use a token from ${TOKENS_FILE})`);
  }
  if (/<\/style/i.test(text)) problems.push(`${rel}: contains </style`);
  return problems;
}

// The page template: no inline styles, event-handler attributes, inline
// scripts or colours; CSS and JS arrive only through the placeholders.
export function templateProblems(rel, text) {
  const problems = [];
  if (/\sstyle\s*=/i.test(text)) problems.push(`${rel}: inline style attribute`);
  if (/\son[a-z]+\s*=/i.test(text)) problems.push(`${rel}: inline event-handler attribute`);
  if (/<script\b/i.test(text)) problems.push(`${rel}: <script> outside the {{SCRIPTS}}/{{ENGINE_DATA}} placeholders`);
  if (/<style\b/i.test(text)) problems.push(`${rel}: <style> outside the {{STYLES}} placeholder`);
  const m = text.match(COLOUR_LITERAL);
  if (m) problems.push(`${rel}: raw colour literal ${m[0]}`);
  return problems;
}
