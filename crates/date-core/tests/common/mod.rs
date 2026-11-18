//! Helpers shared by the integration tests.
#![allow(dead_code)]

use date_core::civil::{days_from_civil, Civil, EpochDay, MAX_EPOCH_DAY, MIN_EPOCH_DAY};

/// Tiny deterministic xorshift64 generator (Marsaglia 13/7/17), so the tests
/// need no `rand` dependency.
pub struct XorShift(u64);

impl XorShift {
    /// A generator from a non-zero seed (zero is replaced by a constant).
    pub fn new(seed: u64) -> Self {
        Self(if seed == 0 {
            0x9E37_79B9_7F4A_7C15
        } else {
            seed
        })
    }

    /// Next 64 random bits.
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// Uniform-ish integer in `lo..=hi` (modulo bias is irrelevant here).
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        let span = (hi - lo) as u64 + 1;
        lo + (self.next_u64() % span) as i64
    }

    /// A random in-range day number.
    pub fn day(&mut self) -> EpochDay {
        self.range(MIN_EPOCH_DAY, MAX_EPOCH_DAY)
    }

    /// `true` with probability 1/2.
    pub fn coin(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

/// Day number of a civil date.
pub fn ymd(y: i64, m: u32, d: u32) -> EpochDay {
    days_from_civil(Civil::new(y, m, d))
}
