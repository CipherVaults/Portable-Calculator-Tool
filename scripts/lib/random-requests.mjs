// Seeded random requests for the native-vs-WASM differential test (plan
// B14, B15 "WASM ABI": random bytes, oversize input and invalid UTF-8 give an
// error envelope, never a trap). scripts/check-wasm.mjs sends every request
// through the native api_bridge and through engine.wasm and byte-compares
// the answers; this module only makes the requests.
//
// Everything is a pure function of the seed (mulberry32), so a failure is
// reproduced with `node scripts/check-wasm.mjs --seed <seed>`.
//
// Mix (weights per 1,000 random requests):
//   date-typed     230  a date-core golden request whose values are
//                       replaced by others of the same kind (dates, times,
//                       numbers, flags, enum strings seen for that key,
//                       weekend sets), so most still compute a result
//   date-mutated   150  a golden request with 1-3 value-level mutations
//                       (replace with any type, delete, add an unknown key,
//                       a random or broken date, a value from another case)
//   date-cross      70  a golden request sent to a random other known op
//   percent        180  every percent op with random number tokens
//                       (exponents, -0, 1e400, leading zeros, strings, null)
//   meta            40  meta.versions with random bodies
//   unknown-op      80  near-miss, long, empty and non-ASCII op names
//   malformed      110  text-level damage: truncation, junk, duplicate keys,
//                       deep nesting, lone-surrogate escapes, raw controls
//   invalid-utf8    80  invalid UTF-8 inside requests and op names
//   unicode         60  valid non-ASCII text in string fields
// plus a fixed block of cap edges: every known op and two unknown ones at
// cap-1, cap and cap+1 bytes, each as padded JSON, ASCII junk and 0xFF.
import { isUtf8 } from "node:buffer";

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (list) => list[int(list.length)],
    chance: (p) => next() < p,
    range: (lo, hi) => lo + int(hi - lo + 1)
  };
}

const WEIGHTS = [
  ["date-typed", 230],
  ["date-mutated", 150],
  ["date-cross", 70],
  ["percent", 180],
  ["meta", 40],
  ["unknown-op", 80],
  ["malformed", 110],
  ["invalid-utf8", 80],
  ["unicode", 60]
];

// Field names of the percent ops (crates/pcalc-api/src/percent.rs).
export const PERCENT_FIELDS = {
  "percent.change": ["originalValue", "newValue"],
  "percent.percent": ["part", "total"],
  "percent.what": ["percent", "number"],
  "percent.discount": ["price", "discountPercent"],
  "percent.base": ["value", "percent"],
  "percent.markup": ["cost", "sellingPrice"],
  "percent.tax": ["amount", "ratePercent", "mode"],
  "percent.tip": ["bill", "tipPercent", "people"]
};

const NUMBER_TOKENS = [
  "0", "-0", "1", "-1", "100", "0.5", "1e3", "1E-3", "1e+21", "-1e-7", "1e308", "1.7976931348623157e308",
  "1e309", "1e400", "-1e400", "5e-324", "4.9406564584124654e-324", "2.2250738585072011e-308", "9007199254740993",
  "18446744073709551616", "123456789012345678901234567890", "0.30000000000000004", "1.00000000000000011102230246251565404236316680908203125",
  "3.14159", "-273.15", "15", "20", "7", "33.333", "1000000",
  // Not JSON numbers:
  "007", "1.", ".5", "+1", "0x10", "NaN", "Infinity", "-Infinity", "1e", "--1", "1_000"
];
const OTHER_TOKENS = ['"5"', '""', "null", "true", "false", "[]", "{}", "[1]", '{"v":1}', '"add"', '"extract"'];
const UNICODE = [
  "عيد الشركة", "Fête nationale", "Ünïcödé", "日本の祝日", "한국어", "Привет", "😀 party", "e\u0301", "\u200f\u200e",
  "\u2028", "\ufeff", "\u{10ffff}", "a\u0000b", "tab\tquote\"back\\slash", "<b>x</b>", "x".repeat(61), "y".repeat(300)
];
const DATE_TEXTS = ["2024-02-29", "2023-02-29", "0000-01-01", "0001-01-01", "9999-12-31", "10000-01-01", "2024-13-01",
  "2024-00-10", "2024-01-32", "2024-1-1", " 2024-01-01", "2024-01-01 ", "+2024-01-01", "2024/01/01", "20240101", "", "today"];
const TIME_TEXTS = ["00:00", "23:59", "23:59:59", "24:00", "12:60", "1:00", "12:00:60", "12:00:00.5", "noon", ""];

// Byte sequences that are not UTF-8.
const BAD_UTF8 = [
  [0xff], [0xfe], [0x80], [0xbf], [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xed, 0xbf, 0xbf],
  [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xc3], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xc3, 0x28]
];

function walkValues(value, strings, numbers, byKey, key) {
  if (typeof value === "string" || typeof value === "number") {
    (typeof value === "string" ? strings : numbers).add(value);
    if (key !== null) {
      if (!byKey.has(key)) byKey.set(key, new Set());
      const set = byKey.get(key);
      if (set.size < 200) set.add(value);
    }
  } else if (Array.isArray(value)) value.forEach((v) => walkValues(v, strings, numbers, byKey, key));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkValues(v, strings, numbers, byKey, k);
  }
}

const pad2 = (n) => String(n).padStart(2, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

// A value of the same kind as `value` (mostly valid, sometimes just off).
function sameKind(r, value, key, pools) {
  if (typeof value === "boolean") return r.chance(0.5);
  if (typeof value === "number") {
    const seen = pools.byKey.get(key);
    if (seen && r.chance(0.6)) return r.pick([...seen]);
    return Number.isInteger(value) ? value + r.range(-40, 40) : value * (0.5 + r.next());
  }
  if (typeof value === "string") {
    if (DATE_RE.test(value)) {
      const y = r.chance(0.8) ? r.range(1900, 2200) : r.range(1, 9999);
      const m = r.chance(0.97) ? r.range(1, 12) : r.pick([0, 13]);
      const d = r.chance(0.95) ? r.range(1, 28) : r.range(29, 32);
      return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
    }
    if (TIME_RE.test(value)) {
      const t = `${pad2(r.range(0, r.chance(0.97) ? 23 : 24))}:${pad2(r.range(0, 59))}`;
      return r.chance(0.5) ? t + ":" + pad2(r.range(0, 59)) : t;
    }
    const seen = pools.byKey.get(key);
    return seen ? r.pick([...seen]) : value;
  }
  return value;
}

// Replaces about half of the leaves with values of the same kind; arrays of
// small integers (weekends) get a random set.
function typedMutate(r, value, key, pools) {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => Number.isInteger(v) && v >= 0 && v <= 8) && r.chance(0.5)) {
      return [1, 2, 3, 4, 5, 6, 7].filter(() => r.chance(0.3));
    }
    return value.map((v) => typedMutate(r, v, key, pools));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = typedMutate(r, v, k, pools);
    return out;
  }
  return r.chance(0.5) ? sameKind(r, value, key, pools) : value;
}

function makeValue(r, pools) {
  switch (r.int(12)) {
    case 0: return r.pick(pools.strings);
    case 1: return r.pick(pools.numbers);
    case 2: return r.pick(DATE_TEXTS);
    case 3: return `${String(r.range(0, 10000)).padStart(4, "0")}-${String(r.range(0, 13)).padStart(2, "0")}-${String(r.range(0, 32)).padStart(2, "0")}`;
    case 4: return r.pick(TIME_TEXTS);
    case 5: return r.pick([0, -0, 1, -1, 7, 60, 1e21, -1e21, 2 ** 31, 2 ** 53, 2 ** 64, 0.5, -2.75, 1e-9]);
    case 6: return r.pick([true, false, null]);
    case 7: return Array.from({ length: r.int(9) }, () => r.range(-1, 9));
    case 8: return {};
    case 9: return [];
    case 10: return r.pick(UNICODE);
    default: return r.range(-100000, 100000);
  }
}

// Picks a random container + key/index inside `root` (an object).
function randomSlot(r, root) {
  let node = root;
  for (let depth = 0; depth < 4; depth++) {
    const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
    if (keys.length === 0) break;
    const key = r.pick(keys);
    const child = node[key];
    if (child && typeof child === "object" && r.chance(0.5)) {
      node = child;
      continue;
    }
    return { node, key };
  }
  return { node, key: null };
}

function mutateValue(r, obj, pools) {
  const { node, key } = randomSlot(r, obj);
  const roll = r.int(10);
  if (key === null || roll === 0) {
    if (!Array.isArray(node)) node["x" + r.int(100)] = makeValue(r, pools);
    else node.push(makeValue(r, pools));
  } else if (roll <= 2) {
    if (Array.isArray(node)) node.splice(key, 1);
    else delete node[key];
  } else {
    node[key] = makeValue(r, pools);
  }
}

const enc = (text) => Buffer.from(text, "utf8");

// Replaces one number token in a JSON text with a random token.
function swapNumberToken(r, text) {
  const spots = [...text.matchAll(/(?<=[:,[]\s*)-?\d+(\.\d+)?([eE][+-]?\d+)?/g)];
  if (spots.length === 0) return text;
  const m = r.pick(spots);
  return text.slice(0, m.index) + r.pick([...NUMBER_TOKENS, ...OTHER_TOKENS]) + text.slice(m.index + m[0].length);
}

function malform(r, text) {
  switch (r.int(11)) {
    case 0: return text.slice(0, r.int(text.length));
    case 1: { const i = r.int(text.length); return text.slice(0, i) + text.slice(i + 1); }
    case 2: { const i = r.int(text.length + 1); return text.slice(0, i) + r.pick(['"', "{", "}", "[", "]", ",", ":", "\\", "x", " ", "\u0001", "\n"]) + text.slice(i); }
    case 3: return text + r.pick(["}", "{}", ",", " x", "\u0000", "]"]);
    case 4: {
      const m = /"([A-Za-z]+)":/.exec(text);
      return m ? text.replace(/}\s*$/, `,"${m[1]}":${r.pick(["1", '"2024-01-01"', "null", "{}"])}}`) : text;
    }
    case 5: { const n = r.range(100, 200); return "[".repeat(n) + "]".repeat(n); }
    case 6: { const n = r.range(100, 200); return '{"a":'.repeat(n) + "1" + "}".repeat(n); }
    case 7: return text.replace(/"([^"\\]*)"(?=\s*[,}\]])/, `"${r.pick(["\\ud800", "\\udc00", "\\ud83d\\ude00", "\\u0000", "\\x41", "\\u12", "\\q"])}"`);
    case 8: return text.replace(/"([^"\\]*)"(?=\s*[,}\]])/, `"a${r.pick(["\u0001", "\u001f", "\t", "\n", "\u007f"])}b"`);
    case 9: return r.pick(["", " ", "nul", "tru", "{", "}", "[", "{]", '{"', '{"a"}', '{"a":}', "{,}", "[,]", "1 2", '"\\u"']);
    default: return text.replace(/:/, r.pick(["", "::", "=", ": :"]));
  }
}

function insertBytes(r, bytes, seq) {
  const at = r.int(bytes.length + 1);
  return Buffer.concat([bytes.subarray(0, at), Buffer.from(seq), bytes.subarray(at)]);
}

// Pads a request to exactly `len` bytes with trailing spaces (still JSON).
function padTo(text, len) {
  const bytes = enc(text);
  if (bytes.length > len) return Buffer.alloc(len, 0x20);
  return Buffer.concat([bytes, Buffer.alloc(len - bytes.length, 0x20)]);
}

// knownOps: every op name of pcalc-api; caps: op -> cap in bytes.
// dateSeeds: [{op, req}] from the date-core golden (req = raw JSON text).
// Returns [{op: Buffer, req: Buffer, kind, viaBytes}].
export function randomRequests({ seed, count, knownOps, capOf, dateSeeds }) {
  const r = mulberry32(seed);
  const parsedSeeds = dateSeeds.map((s) => ({ op: s.op, req: s.req, value: JSON.parse(s.req) }));
  const strings = new Set();
  const numbers = new Set();
  const byKey = new Map();
  for (const s of parsedSeeds) walkValues(s.value, strings, numbers, byKey, null);
  const pools = { strings: [...strings].slice(0, 5000), numbers: [...numbers].slice(0, 5000), byKey };
  const total = WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  const out = [];
  const push = (kind, op, req, forceBytes = false) => {
    const opBytes = typeof op === "string" ? enc(op) : op;
    const reqBytes = typeof req === "string" ? enc(req) : req;
    // Valid UTF-8 goes through the string APIs (loader call / bridge text),
    // with one in eight through the byte APIs as well; anything else only
    // has the byte path.
    const text = isUtf8(opBytes) && isUtf8(reqBytes);
    out.push({ kind, op: opBytes, req: reqBytes, viaBytes: forceBytes || !text || r.chance(0.125) });
  };
  const seedCase = () => r.pick(parsedSeeds);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // Fixed block: cap edges for every op.
  const capOps = [...knownOps, "history.validate", "nope"];
  for (const op of capOps) {
    const cap = capOf(op);
    const sample = parsedSeeds.find((s) => s.op === op);
    const json = sample ? sample.req : "{}";
    for (const len of [cap - 1, cap, cap + 1]) {
      push("cap-edge", op, padTo(json, len));
      push("cap-edge", op, Buffer.alloc(len, 0x78), true);
      push("cap-edge", op, Buffer.alloc(len, 0xff), true);
    }
  }

  while (out.length < count) {
    let roll = r.int(total);
    let kind = WEIGHTS[0][0];
    for (const [name, w] of WEIGHTS) {
      if (roll < w) {
        kind = name;
        break;
      }
      roll -= w;
    }
    switch (kind) {
      case "date-typed": {
        const s = seedCase();
        push(kind, s.op, JSON.stringify(typedMutate(r, s.value, null, pools)));
        break;
      }
      case "date-mutated": {
        const s = seedCase();
        const value = clone(s.value);
        const n = r.range(1, 3);
        for (let i = 0; i < n; i++) mutateValue(r, value, pools);
        let text = JSON.stringify(value);
        if (r.chance(0.2)) text = swapNumberToken(r, text);
        if (r.chance(0.1)) text = r.pick([" ", "\n", "\t", "\r\n"]) + text + r.pick(["", " ", "\n"]);
        push(kind, s.op, text);
        break;
      }
      case "date-cross": {
        const s = seedCase();
        push(kind, r.pick(knownOps), s.req);
        break;
      }
      case "percent": {
        const op = r.pick(Object.keys(PERCENT_FIELDS));
        const fields = [...PERCENT_FIELDS[op]];
        if (r.chance(0.1)) fields.splice(r.int(fields.length), 1);
        if (r.chance(0.1)) fields.push(r.pick(["x", "Percent", "mode", "people"]));
        if (r.chance(0.15)) fields.reverse();
        const token = (f) =>
          f === "mode" && r.chance(0.8)
            ? r.pick(['"add"', '"extract"', '"Add"', '""', '"remove"', "1", "null"])
            : r.chance(0.85)
              ? r.pick(NUMBER_TOKENS)
              : r.pick(OTHER_TOKENS);
        const body = fields.map((f) => `"${f}":${token(f)}`).join(r.pick([",", ", ", ","]));
        push(kind, op, r.chance(0.05) ? `[${body.replace(/"[A-Za-z]+":/g, "")}]` : `{${body}}`);
        break;
      }
      case "meta": {
        push(kind, "meta.versions", r.pick(["{}", " {} ", "{ }\n", '{"x":1}', "[]", "", "null", "{}{}", '{"api":1}', "{", "\u00a0{}", "\ufeff{}"]));
        break;
      }
      case "unknown-op": {
        const known = r.pick(knownOps);
        const op = r.pick([
          known.toUpperCase(),
          known + " ",
          " " + known,
          known.replace(".", "_"),
          known.replace(".", ""),
          known.slice(0, -1),
          known + "s",
          "date",
          "date.",
          "." + known.split(".")[1],
          "calc_" + known.split(".")[1],
          "calc.press",
          "history.validate",
          "legacy.preview",
          "units.convert",
          "",
          "x".repeat(64),
          "x".repeat(65),
          "ä".repeat(32),
          known.replace("a", "\u0430"),
          known + "\u0000"
        ]);
        push(kind, op, seedCase().req);
        break;
      }
      case "malformed": {
        const s = seedCase();
        push(kind, r.chance(0.8) ? s.op : r.pick(knownOps), malform(r, s.req));
        break;
      }
      case "invalid-utf8": {
        const s = seedCase();
        const seq = r.pick(BAD_UTF8);
        if (r.chance(0.2)) push(kind, insertBytes(r, enc(s.op), seq), enc(s.req));
        else {
          // Inside a string value (after a quote) or anywhere.
          let req = enc(s.req);
          const quote = req.indexOf(0x22, r.int(Math.max(1, req.length - 1)));
          req = quote >= 0 && r.chance(0.6)
            ? Buffer.concat([req.subarray(0, quote + 1), Buffer.from(seq), req.subarray(quote + 1)])
            : insertBytes(r, req, seq);
          push(kind, s.op, req);
        }
        break;
      }
      default: {
        // unicode: valid non-ASCII text in a string field.
        const s = seedCase();
        const value = clone(s.value);
        const text = JSON.stringify(value).replace(/"([^"\\]*)"(?=\s*[,}\]])/g, (whole, inner) =>
          r.chance(0.3) ? JSON.stringify(r.pick(UNICODE)) : whole
        );
        push("unicode", s.op, text);
      }
    }
  }
  return out;
}
