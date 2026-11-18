//! Length units relative to the metre. Every factor is exact by
//! definition (the international inch is 0.0254 m, 1959).

use crate::Unit;

const SI: &str = "SI Brochure";
const NIST: &str = "NIST SP 811";

/// The Length table, in display order.
pub const UNITS: [Unit; 11] = [
    Unit {
        id: "nm",
        symbol: "nm",
        num: "1",
        den: "1000000000",
        exact: true,
        source: SI,
    },
    Unit {
        id: "um",
        symbol: "\u{00B5}m",
        num: "1",
        den: "1000000",
        exact: true,
        source: SI,
    },
    Unit {
        id: "mm",
        symbol: "mm",
        num: "1",
        den: "1000",
        exact: true,
        source: SI,
    },
    Unit {
        id: "cm",
        symbol: "cm",
        num: "1",
        den: "100",
        exact: true,
        source: SI,
    },
    Unit {
        id: "m",
        symbol: "m",
        num: "1",
        den: "1",
        exact: true,
        source: SI,
    },
    Unit {
        id: "km",
        symbol: "km",
        num: "1000",
        den: "1",
        exact: true,
        source: SI,
    },
    Unit {
        id: "in",
        symbol: "in",
        num: "254",
        den: "10000",
        exact: true,
        source: NIST,
    },
    Unit {
        id: "ft",
        symbol: "ft",
        num: "3048",
        den: "10000",
        exact: true,
        source: NIST,
    },
    Unit {
        id: "yd",
        symbol: "yd",
        num: "9144",
        den: "10000",
        exact: true,
        source: NIST,
    },
    Unit {
        id: "mi",
        symbol: "mi",
        num: "1609344",
        den: "1000",
        exact: true,
        source: NIST,
    },
    Unit {
        id: "nmi",
        symbol: "nmi",
        num: "1852",
        den: "1",
        exact: true,
        source: NIST,
    },
];
