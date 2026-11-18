//! Persistent stdin/stdout NDJSON bridge for `pcalc_api::call`, used by
//! `scripts/check-wasm.mjs` to compare the native build with `engine.wasm`.
//!
//! Each input line is `{"op":"<op>","req":"<request JSON text>"}`: `req` is a
//! JSON **string** holding the exact request bytes, so the bridge passes the
//! very same text to `call` that the WASM loader passes to `pc_call`. For
//! bytes that are not valid UTF-8 (which a JSON string cannot carry), `opHex`
//! and/or `reqHex` replace `op` / `req` with the bytes in hex, and the bridge
//! calls `call_bytes`, the WASM ABI's own entry point. Each output line is
//! exactly the envelope the API returned, in input order, flushed per line.
//! Blank lines get no answer; a line that is not that shape (including both
//! or neither of `op`/`opHex`, `req`/`reqHex`, or bad hex), or longer than
//! [`MAX_LINE_BYTES`], gets the `invalid_request` envelope.
//!
//! Build (PowerShell): `cargo build -p pcalc-api --release --example api_bridge --locked`

use std::io::{self, BufRead, BufWriter, Write};

use serde::Deserialize;

/// Escaping or hex can double a request, so the line cap is twice the
/// largest op cap plus room for the wrapper.
const MAX_LINE_BYTES: usize = 2 * pcalc_api::MAX_REQUEST_BYTES + 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Line {
    op: Option<String>,
    req: Option<String>,
    op_hex: Option<String>,
    req_hex: Option<String>,
}

/// Decodes lower- or upper-case hex; `None` for an odd length or a non-hex
/// character.
fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    fn nibble(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    }
    let (pairs, rest) = hex.as_bytes().as_chunks::<2>();
    if !rest.is_empty() {
        return None;
    }
    pairs
        .iter()
        .map(|&[high, low]| Some((nibble(high)? << 4) | nibble(low)?))
        .collect()
}

/// Exactly one of the text and the hex form.
fn one_of(text: Option<String>, hex: Option<String>) -> Option<Vec<u8>> {
    match (text, hex) {
        (Some(text), None) => Some(text.into_bytes()),
        (None, Some(hex)) => decode_hex(&hex),
        _ => None,
    }
}

/// Answers one parsed line: text ops go through `call` (what the desktop
/// command runs), anything with hex through `call_bytes`.
fn answer(line: Line) -> String {
    if let (Some(op), Some(req), None, None) = (&line.op, &line.req, &line.op_hex, &line.req_hex) {
        return pcalc_api::call(op, req);
    }
    match (one_of(line.op, line.op_hex), one_of(line.req, line.req_hex)) {
        (Some(op), Some(req)) => pcalc_api::call_bytes(&op, &req),
        _ => invalid(),
    }
}

fn invalid() -> String {
    pcalc_api::ApiError::INVALID_REQUEST.to_json()
}

/// Answers one line (without its newline).
fn process_line(line: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(line).ok();
    match text.map(str::trim) {
        Some("") => None,
        Some(t) => Some(match serde_json::from_str::<Line>(t) {
            Ok(l) => answer(l),
            Err(_) => invalid(),
        }),
        None => Some(invalid()),
    }
}

/// Reads one line of at most `max` bytes into `out`. Returns `None` at EOF,
/// `Some(true)` for a line that fits and `Some(false)` for one that did not
/// (it is consumed and discarded).
fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    max: usize,
    out: &mut Vec<u8>,
) -> io::Result<Option<bool>> {
    out.clear();
    let mut fits = true;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            return Ok(if out.is_empty() && fits {
                None
            } else {
                Some(fits)
            });
        }
        let (chunk, done) = match buf.iter().position(|&b| b == b'\n') {
            Some(pos) => (&buf[..pos], Some(pos + 1)),
            None => (buf, None),
        };
        if fits && out.len() + chunk.len() <= max {
            out.extend_from_slice(chunk);
        } else {
            fits = false;
            out.clear();
        }
        let used = done.unwrap_or(buf.len());
        reader.consume(used);
        if done.is_some() {
            return Ok(Some(fits));
        }
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = io::BufReader::with_capacity(1 << 20, stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let mut line = Vec::new();
    while let Some(fits) = read_bounded_line(&mut reader, MAX_LINE_BYTES, &mut line)? {
        let answer = if fits {
            process_line(&line)
        } else {
            Some(invalid())
        };
        if let Some(answer) = answer {
            writer.write_all(answer.as_bytes())?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing() {
        assert_eq!(process_line(b"   "), None);
        assert_eq!(process_line(b"{}"), Some(invalid()));
        assert_eq!(process_line(b"\xFF"), Some(invalid()));
        assert_eq!(
            process_line(br#"{"op":"meta.versions","req":"{}","x":1}"#),
            Some(invalid())
        );
        let meta = process_line(br#"{"op":"meta.versions","req":"{}"}"#).unwrap();
        assert_eq!(meta, pcalc_api::call("meta.versions", "{}"));
        let unknown = process_line(br#"{"op":"nope","req":"{}"}"#).unwrap();
        assert!(unknown.contains("unknown_op"));
    }

    #[test]
    fn hex_forms_carry_raw_bytes() {
        // "meta.versions" / "{}" in hex, and mixed with text.
        let meta = pcalc_api::call("meta.versions", "{}");
        let op_hex = "6d6574612e76657273696f6e73";
        for line in [
            format!(r#"{{"opHex":"{op_hex}","reqHex":"7B7d"}}"#),
            format!(r#"{{"opHex":"{op_hex}","req":"{{}}"}}"#),
            r#"{"op":"meta.versions","reqHex":"7b7d"}"#.to_string(),
        ] {
            assert_eq!(process_line(line.as_bytes()), Some(meta.clone()), "{line}");
        }
        // Invalid UTF-8 in the request is the API's invalid_request, in the
        // op name unknown_op: exactly what call_bytes answers.
        assert_eq!(
            process_line(br#"{"op":"date.age","reqHex":"ff"}"#),
            Some(pcalc_api::call_bytes(b"date.age", &[0xFF]))
        );
        assert_eq!(
            process_line(br#"{"opHex":"ff","req":"{}"}"#),
            Some(pcalc_api::ApiError::UNKNOWN_OP.to_json())
        );
        // Framing errors: both forms, neither, odd length, non-hex.
        for bad in [
            r#"{"op":"meta.versions","opHex":"00","req":"{}"}"#,
            r#"{"req":"{}"}"#,
            r#"{"op":"meta.versions"}"#,
            r#"{"op":"meta.versions","reqHex":"7b7"}"#,
            r#"{"op":"meta.versions","reqHex":"zz"}"#,
        ] {
            assert_eq!(process_line(bad.as_bytes()), Some(invalid()), "{bad}");
        }
        assert_eq!(decode_hex(""), Some(Vec::new()));
        assert_eq!(decode_hex("00fF"), Some(vec![0, 255]));
    }

    #[test]
    fn bounded_lines() {
        let mut cursor = io::Cursor::new(b"aaaaaaaaaa\nok\nlast".to_vec());
        let mut buf = Vec::new();
        assert_eq!(
            read_bounded_line(&mut cursor, 4, &mut buf).unwrap(),
            Some(false)
        );
        assert_eq!(
            read_bounded_line(&mut cursor, 4, &mut buf).unwrap(),
            Some(true)
        );
        assert_eq!(buf, b"ok");
        assert_eq!(
            read_bounded_line(&mut cursor, 4, &mut buf).unwrap(),
            Some(true)
        );
        assert_eq!(buf, b"last");
        assert_eq!(read_bounded_line(&mut cursor, 4, &mut buf).unwrap(), None);
    }
}
