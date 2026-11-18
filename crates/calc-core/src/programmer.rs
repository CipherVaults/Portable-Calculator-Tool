//! Programmer mode vocabulary (plan B6): word sizes over a masked `u64`,
//! number bases, and two's-complement views. The key machine (`prog.press`)
//! arrives in M6.

use serde::{Deserialize, Serialize};

/// Word size; every value is a `u64` masked to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WordSize {
    /// 64 bits.
    Qword,
    /// 32 bits.
    Dword,
    /// 16 bits.
    Word,
    /// 8 bits.
    Byte,
}

impl WordSize {
    /// Number of bits.
    pub const fn bits(self) -> u32 {
        match self {
            WordSize::Qword => 64,
            WordSize::Dword => 32,
            WordSize::Word => 16,
            WordSize::Byte => 8,
        }
    }

    /// The mask of the low `bits()` bits.
    pub const fn mask(self) -> u64 {
        match self {
            WordSize::Qword => u64::MAX,
            other => (1u64 << other.bits()) - 1,
        }
    }

    /// `value` masked to this word size.
    pub const fn wrap(self, value: u64) -> u64 {
        value & self.mask()
    }

    /// The two's-complement signed reading of a (masked) value.
    pub const fn to_signed(self, value: u64) -> i64 {
        let v = self.wrap(value);
        let bits = self.bits();
        if bits == 64 {
            v as i64
        } else if v >> (bits - 1) & 1 == 1 {
            (v | !self.mask()) as i64
        } else {
            v as i64
        }
    }
}

/// Display base.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Base {
    /// Base 16.
    Hex,
    /// Base 10.
    Dec,
    /// Base 8.
    Oct,
    /// Base 2.
    Bin,
}

impl Base {
    /// The radix.
    pub const fn radix(self) -> u32 {
        match self {
            Base::Hex => 16,
            Base::Dec => 10,
            Base::Oct => 8,
            Base::Bin => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_and_twos_complement() {
        assert_eq!(WordSize::Byte.mask(), 0xFF);
        assert_eq!(WordSize::Qword.mask(), u64::MAX);
        assert_eq!(WordSize::Byte.wrap(0x1FF), 0xFF);
        assert_eq!(WordSize::Byte.to_signed(0xFF), -1);
        assert_eq!(WordSize::Byte.to_signed(0x7F), 127);
        assert_eq!(WordSize::Word.to_signed(0x8000), -32768);
        assert_eq!(WordSize::Qword.to_signed(u64::MAX), -1);
        assert_eq!(WordSize::Dword.to_signed(0x1_0000_0001), 1);
        assert_eq!(
            [Base::Hex, Base::Dec, Base::Oct, Base::Bin].map(Base::radix),
            [16, 10, 8, 2]
        );
    }
}
