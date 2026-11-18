//! pcalc-wasm: `engine.wasm`, a raw string-in / string-out ABI over
//! [`pcalc_api::call_bytes`]. No wasm-bindgen: there is no generated glue
//! to pin or audit (plan B3).
//!
//! # ABI (version [`ABI_VERSION`])
//!
//! | Export | Meaning |
//! |---|---|
//! | `pc_abi() -> u32` | the ABI version (1) |
//! | `pc_in(len) -> u32` | sizes the input buffer to `len` bytes and returns its address, or 0 when `len` is over [`MAX_INPUT_BYTES`] |
//! | `pc_call(op_len, req_len) -> u32` | runs the op whose name is the first `op_len` input bytes on the next `req_len` bytes, stores the envelope and returns its length |
//! | `pc_out() -> u32` | the address of the stored envelope |
//!
//! The loader (`web/src/core/engine-web.js`) encodes `op` and `req` with
//! `TextEncoder`, calls `pc_in(op_len + req_len)`, copies both into memory,
//! calls `pc_call`, then reads `pc_out()` .. `+len` and decodes it. It
//! re-reads `memory.buffer` after every call because the memory may grow.
//!
//! # Safety rules
//!
//! `#![deny(unsafe_code)]`; the only `#[allow(unsafe_code)]` items are the
//! four `#[unsafe(no_mangle)]` export attributes. The buffers are
//! `thread_local!` `RefCell<Vec<u8>>`s: the module is single-threaded, JS
//! only touches them between calls, and every borrow is a `try_borrow*`, so
//! nothing here can panic.
#![deny(unsafe_code)]

use std::cell::RefCell;

/// ABI version reported by `pc_abi`.
pub const ABI_VERSION: u32 = 1;

/// Largest input (`op` + `req`) `pc_in` accepts.
pub const MAX_INPUT_BYTES: usize = pcalc_api::MAX_OP_BYTES + pcalc_api::MAX_REQUEST_BYTES;

/// Capacity kept after a call, so one large import does not pin 8 MiB.
const RETAINED_BYTES: usize = pcalc_api::CAP_ENGINE;

thread_local! {
    static IN: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Sizes the input buffer; returns its address, or 0 on refusal.
fn input_reserve(len: usize) -> usize {
    IN.with(|cell| match cell.try_borrow_mut() {
        Ok(mut buf) => {
            buf.clear();
            if len > MAX_INPUT_BYTES {
                buf.shrink_to(RETAINED_BYTES);
                return 0;
            }
            buf.resize(len, 0);
            buf.as_mut_ptr() as usize
        }
        Err(_) => 0,
    })
}

/// Runs the buffered call; stores the envelope and returns its length.
fn input_call(op_len: usize, req_len: usize) -> usize {
    let envelope = IN
        .with(|cell| {
            let mut buf = cell.try_borrow_mut().ok()?;
            let result = match op_len.checked_add(req_len) {
                Some(total) if total == buf.len() => {
                    let (op, req) = buf.split_at(op_len);
                    Some(pcalc_api::call_bytes(op, req))
                }
                _ => None,
            };
            buf.clear();
            buf.shrink_to(RETAINED_BYTES);
            result
        })
        .unwrap_or_else(|| pcalc_api::ApiError::INVALID_REQUEST.to_json());
    OUT.with(|cell| match cell.try_borrow_mut() {
        Ok(mut out) => {
            out.clear();
            out.shrink_to(RETAINED_BYTES);
            out.extend_from_slice(envelope.as_bytes());
            out.len()
        }
        Err(_) => 0,
    })
}

/// Address of the stored envelope.
fn output_address() -> usize {
    OUT.with(|cell| match cell.try_borrow_mut() {
        Ok(mut out) => out.as_mut_ptr() as usize,
        Err(_) => 0,
    })
}

/// `pc_abi() -> u32`: the ABI version.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn pc_abi() -> u32 {
    ABI_VERSION
}

/// `pc_in(len) -> u32`: input buffer address, or 0 when `len` is too large.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn pc_in(len: u32) -> u32 {
    input_reserve(len as usize) as u32
}

/// `pc_call(op_len, req_len) -> u32`: runs the call, returns the envelope
/// length.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn pc_call(op_len: u32, req_len: u32) -> u32 {
    input_call(op_len as usize, req_len as usize) as u32
}

/// `pc_out() -> u32`: the envelope's address.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn pc_out() -> u32 {
    output_address() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Native stand-in for the loader: fills IN through the safe API.
    fn run(op: &[u8], req: &[u8]) -> String {
        assert_ne!(input_reserve(op.len() + req.len()), 0);
        IN.with(|cell| {
            let mut buf = cell.borrow_mut();
            buf[..op.len()].copy_from_slice(op);
            buf[op.len()..].copy_from_slice(req);
        });
        let len = input_call(op.len(), req.len());
        assert_ne!(output_address(), 0);
        let out = OUT.with(|cell| cell.borrow().clone());
        assert_eq!(out.len(), len);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn abi_round_trip_matches_the_api() {
        assert_eq!(pc_abi(), 1);
        for (op, req) in [
            ("meta.versions", "{}"),
            (
                "date.age",
                r#"{"birthDate":"2000-02-29","asOfDate":"2024-02-28"}"#,
            ),
            ("percent.change", r#"{"originalValue":150,"newValue":180}"#),
            ("nope", "{}"),
        ] {
            assert_eq!(run(op.as_bytes(), req.as_bytes()), pcalc_api::call(op, req));
        }
        assert_eq!(
            run(b"percent.change", b"\xFF"),
            pcalc_api::ApiError::INVALID_REQUEST.to_json()
        );
    }

    #[test]
    fn length_mismatch_and_oversize_are_refused() {
        assert_ne!(input_reserve(4), 0);
        let out = input_call(2, 3);
        assert_eq!(out, pcalc_api::ApiError::INVALID_REQUEST.to_json().len());
        assert_eq!(input_call(usize::MAX, 1), out);
        assert_eq!(input_reserve(MAX_INPUT_BYTES + 1), 0);
        // After a refusal the buffer is empty, so a stale call is refused too.
        assert_eq!(input_call(0, 0), pcalc_api::call("", "").len());
    }
}
