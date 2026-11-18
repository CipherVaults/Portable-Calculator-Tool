//! Persistent stdin/stdout NDJSON evaluation bridge for `date-core`.
//!
//! Reads one JSON request per line from stdin and writes one compact JSON
//! response per line to stdout, flushing after every line (the same framing
//! as the reference project's bridge, including its 64 KiB line cap).
//!
//! Request: `{"op": "<name>", "req": {...}, "id": <any, optional>}` where
//! `op` is one of the nine FROZEN §2 function names (`calc_days_between`,
//! `calc_add_subtract`, `calc_business_days`, `calc_age`, `calc_date_info`,
//! `calc_countdown`, `holidays_in_range`, `month_grid`, `validate_calendar`)
//! and `req` is that function's request object.
//!
//! Response: exactly the [`date_core::Outcome`] envelope that the Tauri
//! command returns, `{"ok":"true","result":{...}}` or
//! `{"ok":"false","error":{...}}`, byte for byte as in `golden.json`. When the
//! request carries a non-null `id`, it is echoed as the first key:
//! `{"id":7,"ok":"true",...}`.
//!
//! Every framing problem (over-long line, invalid UTF-8, malformed JSON,
//! unknown op, unknown top-level key, bad `req`) gets the `invalid_request`
//! envelope, so callers parse a single response shape.

use std::io::{self, BufRead, BufWriter, Write};

use date_core::api::{self, Op, MAX_REQUEST_BYTES};
use date_core::{CoreError, Outcome};
use serde::Deserialize;
use serde_json::Value;

/// One bridge request line.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BridgeRequest {
    /// Echoed back as the response's first key when present and non-null.
    #[serde(default)]
    id: Option<Value>,
    /// FROZEN §2 function name.
    op: String,
    /// The request object for `op`.
    req: Value,
}

/// The `invalid_request` envelope, for failures before an op is known.
fn invalid_request_json() -> String {
    let outcome: Outcome<()> = Outcome::Err {
        error: CoreError::invalid_request(),
    };
    serde_json::to_string(&outcome).unwrap_or_else(|_| {
        r#"{"ok":"false","error":{"code":"invalid_request","field":null,"message":"Invalid request."}}"#
            .to_string()
    })
}

/// Prefixes `"id":<id>,` to an envelope (which always starts with `{"ok":`).
fn with_id(id: Option<&Value>, envelope: String) -> String {
    match id {
        Some(id) if !id.is_null() => {
            match (serde_json::to_string(id), envelope.strip_prefix('{')) {
                (Ok(id_json), Some(rest)) => format!("{{\"id\":{id_json},{rest}"),
                _ => envelope,
            }
        }
        _ => envelope,
    }
}

/// Handles one request line and returns the response line (no newline).
fn process_line(line: &str) -> String {
    let req: BridgeRequest = match serde_json::from_str(line) {
        Ok(parsed) => parsed,
        Err(_) => return invalid_request_json(),
    };
    let envelope = match Op::from_name(&req.op) {
        Some(op) => serde_json::to_string(&api::call(op, &req.req))
            .unwrap_or_else(|_| invalid_request_json()),
        None => invalid_request_json(),
    };
    with_id(req.id.as_ref(), envelope)
}

/// Reads one line of at most `max_bytes` bytes (newline included) into
/// `out`. Returns `None` at end of input, `Some(true)` for a line that fits
/// and `Some(false)` for an over-long line, which is consumed and discarded
/// without ever being buffered in full.
fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    max_bytes: usize,
    out: &mut Vec<u8>,
) -> io::Result<Option<bool>> {
    out.clear();
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            return Ok(if out.is_empty() { None } else { Some(true) });
        }
        if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let chunk = &buf[..=pos];
            if out.len().saturating_add(chunk.len()) > max_bytes {
                reader.consume(pos + 1);
                out.clear();
                return Ok(Some(false));
            }
            out.extend_from_slice(chunk);
            reader.consume(pos + 1);
            return Ok(Some(true));
        }
        let len = buf.len();
        if out.len().saturating_add(len) > max_bytes {
            reader.consume(len);
            loop {
                let rest = reader.fill_buf()?;
                if rest.is_empty() {
                    break;
                }
                if let Some(pos) = rest.iter().position(|&b| b == b'\n') {
                    reader.consume(pos + 1);
                    break;
                }
                let rlen = rest.len();
                reader.consume(rlen);
            }
            out.clear();
            return Ok(Some(false));
        }
        out.extend_from_slice(buf);
        reader.consume(len);
    }
}

/// Turns one raw line into its response, or `None` for a blank line (which
/// gets no response, as in the reference bridge).
fn respond(raw_line: &[u8], fits: bool) -> Option<String> {
    if !fits {
        return Some(invalid_request_json());
    }
    let Ok(line) = std::str::from_utf8(raw_line) else {
        return Some(invalid_request_json());
    };
    let trimmed = line.trim_matches(|c| matches!(c, ' ' | '\t' | '\n' | '\r'));
    if trimmed.is_empty() {
        return None;
    }
    Some(process_line(trimmed))
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let mut raw_line = Vec::new();

    while let Some(fits) = read_bounded_line(&mut reader, MAX_REQUEST_BYTES, &mut raw_line)? {
        if let Some(resp) = respond(&raw_line, fits) {
            writer.write_all(resp.as_bytes())?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const INVALID: &str = r#"{"ok":"false","error":{"code":"invalid_request","field":null,"message":"Invalid request."}}"#;

    #[test]
    fn answers_every_op_with_the_envelope() {
        let r = process_line(
            r#"{"op":"calc_days_between","req":{"startDate":"2024-01-01","endDate":"2024-03-01"}}"#,
        );
        assert!(r.starts_with(r#"{"ok":"true","result":{"startDate":"2024-01-01""#));
        let r = process_line(
            r#"{"id":"a1","op":"calc_age","req":{"birthDate":"2025-01-02","asOfDate":"2025-01-01"}}"#,
        );
        assert!(r.starts_with(r#"{"id":"a1","ok":"false","error":{"code":"birth_after_as_of""#));
        for op in Op::ALL {
            let r = process_line(&format!(r#"{{"op":"{}","req":{{}}}}"#, op.name()));
            assert!(r.starts_with(r#"{"ok":""#), "{op:?}: {r}");
        }
    }

    #[test]
    fn framing_errors_are_invalid_request() {
        assert_eq!(invalid_request_json(), INVALID);
        for line in [
            "{",
            "[]",
            "null",
            r#"{"op":"calc_age"}"#,
            r#"{"op":"calc_ages","req":{}}"#,
            r#"{"op":"CALC_AGE","req":{}}"#,
            r#"{"op":"calc_age","req":{},"extra":1}"#,
            r#"{"op":"calc_age","req":{"birthDate":1}}"#,
            r#"{"op":"calc_age","req":{"birthdate":"2024-01-01"}}"#,
            r#"{"op":"calc_age","req":[]}"#,
            r#"{"op":"calc_days_between","req":["2024-01-01","2024-01-02"]}"#,
            r#"{"op":"calc_business_days","req":{"calendar":[[6,7]]}}"#,
            r#"{"op":"calc_countdown","req":{"now":["2024-01-01","12:00"]}}"#,
            r#"{"op":"validate_calendar","req":{"calendar":{"customHolidays":[["c-00000000","X","date"]]}}}"#,
            // Enums are strings only, never serde's `{"variant": null}` map form.
            r#"{"op":"calc_add_subtract","req":{"date":"2024-01-31","operation":{"add":null},"months":"1"}}"#,
            r#"{"op":"calc_age","req":{"birthDate":"2020-02-29","asOfDate":"2021-03-01","leapDayRule":{"mar1":null}}}"#,
            r#"{"op":"month_grid","req":{"year":2024,"month":2,"firstDayOfWeek":{"sunday":null}}}"#,
            r#"{"op":"validate_calendar","req":{"calendar":{"preset":{"eg":null},"observedMode":{"both":null}}}}"#,
            r#"{"op":"validate_calendar","req":{"calendar":{"hijriOverrides":[{"hijriYear":1445,"event":{"eidAlFitr":null},"date":"2024-04-10"}]}}}"#,
            r#"{"op":"validate_calendar","req":{"calendar":{"customHolidays":[{"id":"c-00000001","name":"X","kind":{"date":null},"date":"2024-01-01"}]}}}"#,
            r#"{"op":"calc_add_subtract","req":{"date":"2024-01-31","operation":["add"],"months":"1"}}"#,
            r#"{"op":"calc_add_subtract","req":{"date":"2024-01-31","operation":0,"months":"1"}}"#,
        ] {
            assert_eq!(process_line(line), INVALID, "{line}");
        }
        assert_eq!(
            process_line(r#"{"id":3,"op":"nope","req":{}}"#),
            format!("{{\"id\":3,{}", &INVALID[1..])
        );
        assert_eq!(respond(&[0xFF, b'{'], true).as_deref(), Some(INVALID));
        assert_eq!(respond(b"  \r\n", true), None);
        assert_eq!(respond(b"{}", false).as_deref(), Some(INVALID));
    }

    #[test]
    fn string_enums_still_accepted() {
        for line in [
            r#"{"op":"calc_add_subtract","req":{"date":"2024-01-31","operation":"add","months":"1"}}"#,
            r#"{"op":"calc_age","req":{"birthDate":"2020-02-29","asOfDate":"2021-03-01","leapDayRule":"mar1"}}"#,
            r#"{"op":"month_grid","req":{"year":2024,"month":2,"firstDayOfWeek":"sunday"}}"#,
            r#"{"op":"validate_calendar","req":{"calendar":{"preset":"eg","observedMode":"both","hijriOverrides":[{"hijriYear":1445,"event":"eidAlFitr","date":"2024-04-10"}],"customHolidays":[{"id":"c-00000001","name":"X","kind":"date","date":"2024-01-01"}]}}}"#,
        ] {
            assert!(process_line(line).starts_with(r#"{"ok":"true""#), "{line}");
        }
    }

    #[test]
    fn bounded_reader_discards_long_lines() {
        let mut oversized = "a".repeat(80);
        oversized.push('\n');
        oversized.push_str("ok\n");
        let mut cursor = io::Cursor::new(oversized.into_bytes());
        let mut buf = Vec::new();
        assert_eq!(
            read_bounded_line(&mut cursor, 32, &mut buf).unwrap(),
            Some(false)
        );
        assert_eq!(
            read_bounded_line(&mut cursor, 32, &mut buf).unwrap(),
            Some(true)
        );
        assert_eq!(buf, b"ok\n");
        assert_eq!(read_bounded_line(&mut cursor, 32, &mut buf).unwrap(), None);
    }
}
