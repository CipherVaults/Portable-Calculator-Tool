//! Persistent stdin/stdout NDJSON bridge for `pcalc_api::call`, used by
//! `scripts/check-wasm.mjs` to compare the native build with `engine.wasm`.
//!
//! Each input line is `{"op":"<op>","req":"<request JSON text>"}`: `req` is a
//! JSON **string** holding the exact request bytes, so the bridge passes the
//! very same text to `call` that the WASM loader passes to `pc_call`. Each
//! output line is exactly the envelope `call` returned, in input order,
//! flushed per line. Blank lines get no answer; a line that is not that
//! shape, or longer than [`MAX_LINE_BYTES`], gets the `invalid_request`
//! envelope.
//!
//! Build (PowerShell): `cargo build -p pcalc-api --release --example api_bridge --locked`

use std::io::{self, BufRead, BufWriter, Write};

use serde::Deserialize;

/// Escaping can double a request, so the line cap is twice the largest op
/// cap plus room for the wrapper.
const MAX_LINE_BYTES: usize = 2 * pcalc_api::MAX_REQUEST_BYTES + 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    op: String,
    req: String,
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
            Ok(l) => pcalc_api::call(&l.op, &l.req),
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
