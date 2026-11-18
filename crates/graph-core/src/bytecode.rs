//! Stack bytecode produced by `graph.compile` and run per sample.

use serde::{Deserialize, Serialize};

/// A unary function.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Func {
    /// sine
    Sin,
    /// cosine
    Cos,
    /// tangent
    Tan,
    /// natural logarithm
    Ln,
    /// base-10 logarithm
    Log,
    /// square root
    Sqrt,
    /// absolute value
    Abs,
    /// e^x
    Exp,
}

impl Func {
    /// Looks a function up by its calc-core identifier.
    pub fn from_ident(name: &str) -> Option<Func> {
        Some(match name {
            "sin" => Func::Sin,
            "cos" => Func::Cos,
            "tan" => Func::Tan,
            "ln" => Func::Ln,
            "log" => Func::Log,
            "sqrt" => Func::Sqrt,
            "abs" => Func::Abs,
            "exp" => Func::Exp,
            _ => return None,
        })
    }
}

/// One instruction of a compiled function. Constants are stored as their
/// canonical `Dec` text so the compiled form is exact and portable; they are
/// converted to `f64` once, when sampling starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Instr {
    /// Push a constant.
    Const(String),
    /// Push the sample's `x`.
    X,
    /// Pop b, pop a, push a + b.
    Add,
    /// Pop b, pop a, push a - b.
    Sub,
    /// Pop b, pop a, push a * b.
    Mul,
    /// Pop b, pop a, push a / b.
    Div,
    /// Pop b, pop a, push a ^ b.
    Pow,
    /// Pop a, push -a.
    Neg,
    /// Pop a, push f(a).
    Call(Func),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_names_and_instruction_form() {
        assert_eq!(Func::from_ident("sin"), Some(Func::Sin));
        assert_eq!(Func::from_ident("SIN"), None);
        let program = vec![
            Instr::X,
            Instr::Call(Func::Sin),
            Instr::Const("2".into()),
            Instr::Mul,
        ];
        assert_eq!(
            serde_json::to_string(&program).unwrap(),
            r#"["x",{"call":"sin"},{"const":"2"},"mul"]"#
        );
    }
}
