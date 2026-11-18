//! graph-core: `y = f(x)` graphing — expression bytecode and f64 sampling.
//!
//! See `Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`, section B7.
//!
//! # Rules
//!
//! - Pure and total: `#![forbid(unsafe_code)]`, no clock, locale or I/O, no
//!   panics.
//! - This is the only engine that computes in `f64`. Transcendentals come
//!   from the pinned pure-Rust `libm` (owner-approved exception to "serde
//!   only"), never from `std`'s platform intrinsics, so native and WASM
//!   samples are bit-identical.
//!
//! # Status (M0 skeleton)
//!
//! Implemented now: the request limits, the [`Viewport`] validator and the
//! [`bytecode::Instr`] set. Planned (M8): `graph.compile` (via the calc-core
//! tokenizer, implicit multiplication, spans on errors), `graph.sample`
//! (2 samples per column, adaptive refinement to depth 6, segment breaks)
//! and `graph.trace`.
#![forbid(unsafe_code)]

pub mod bytecode;

use serde::{Deserialize, Serialize};

/// Engine version; equal to the crate version (asserted by a test).
pub const ENGINE_VERSION: &str = "0.1.0";

/// Most functions on one graph.
pub const MAX_FUNCTIONS: usize = 6;

/// Longest function text, in characters.
pub const MAX_FUNCTION_CHARS: usize = 512;

/// Deepest expression nesting.
pub const MAX_DEPTH: usize = 64;

/// Deepest adaptive refinement per column.
pub const MAX_REFINE_DEPTH: u32 = 6;

/// Largest canvas side, in CSS pixels.
pub const MAX_CANVAS_PX: u32 = 8192;

/// The visible window and canvas size of a `graph.sample` request.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Viewport {
    /// Left edge.
    pub x_min: f64,
    /// Right edge.
    pub x_max: f64,
    /// Bottom edge.
    pub y_min: f64,
    /// Top edge.
    pub y_max: f64,
    /// Canvas width in pixels.
    pub width_px: u32,
    /// Canvas height in pixels.
    pub height_px: u32,
}

/// Why a viewport was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewportError {
    /// A bound is NaN or infinite.
    NonFinite,
    /// `min >= max` on an axis, or the span overflows.
    EmptyRange,
    /// A canvas side is 0 or above [`MAX_CANVAS_PX`].
    BadCanvas,
}

impl Viewport {
    /// Checks every bound is finite, each axis has a positive finite span,
    /// and the canvas is 1..=[`MAX_CANVAS_PX`] on each side.
    pub fn validate(&self) -> Result<(), ViewportError> {
        let bounds = [self.x_min, self.x_max, self.y_min, self.y_max];
        if !bounds.iter().all(|b| b.is_finite()) {
            return Err(ViewportError::NonFinite);
        }
        let x_span = self.x_max - self.x_min;
        let y_span = self.y_max - self.y_min;
        if !(x_span > 0.0 && x_span.is_finite() && y_span > 0.0 && y_span.is_finite()) {
            return Err(ViewportError::EmptyRange);
        }
        let side_ok = |px: u32| (1..=MAX_CANVAS_PX).contains(&px);
        if !side_ok(self.width_px) || !side_ok(self.height_px) {
            return Err(ViewportError::BadCanvas);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vp() -> Viewport {
        Viewport {
            x_min: -10.0,
            x_max: 10.0,
            y_min: -6.0,
            y_max: 6.0,
            width_px: 1200,
            height_px: 720,
        }
    }

    #[test]
    fn engine_version_matches_crate_version() {
        assert_eq!(ENGINE_VERSION, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn viewport_validation() {
        assert_eq!(vp().validate(), Ok(()));
        let with = |f: fn(&mut Viewport)| {
            let mut v = vp();
            f(&mut v);
            v.validate()
        };
        assert_eq!(with(|v| v.x_min = f64::NAN), Err(ViewportError::NonFinite));
        assert_eq!(
            with(|v| v.y_max = f64::INFINITY),
            Err(ViewportError::NonFinite)
        );
        assert_eq!(with(|v| v.x_max = -10.0), Err(ViewportError::EmptyRange));
        assert_eq!(
            with(|v| {
                v.x_min = -f64::MAX;
                v.x_max = f64::MAX;
            }),
            Err(ViewportError::EmptyRange)
        );
        assert_eq!(with(|v| v.width_px = 0), Err(ViewportError::BadCanvas));
        assert_eq!(
            with(|v| v.height_px = MAX_CANVAS_PX + 1),
            Err(ViewportError::BadCanvas)
        );
    }

    #[test]
    fn viewport_request_is_strict() {
        let ok = r#"{"xMin":-1,"xMax":1,"yMin":-1,"yMax":1,"widthPx":10,"heightPx":10}"#;
        assert!(serde_json::from_str::<Viewport>(ok).is_ok());
        let extra = r#"{"xMin":-1,"xMax":1,"yMin":-1,"yMax":1,"widthPx":10,"heightPx":10,"z":1}"#;
        assert!(serde_json::from_str::<Viewport>(extra).is_err());
    }
}
