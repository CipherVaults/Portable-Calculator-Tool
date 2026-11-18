//! Expression tokens and the tokenizer shared by Scientific mode, history
//! restore (`calc.eval`) and graphing (`graph-core`).
//!
//! The token list is also the self-contained history form (B10):
//! `[{n:"<Dec>"}|{op:"+"}|{fn:"sin"}|{p:"("}…]`.

use calc_num::Dec;
use serde::{Deserialize, Serialize};

use crate::{MAX_EXPR_BYTES, MAX_EXPR_TOKENS};

/// A binary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinOp {
    /// `+`
    #[serde(rename = "+")]
    Add,
    /// `-` (also U+2212 MINUS SIGN)
    #[serde(rename = "-")]
    Sub,
    /// `*` (also U+00D7 MULTIPLICATION SIGN)
    #[serde(rename = "*")]
    Mul,
    /// `/` (also U+00F7 DIVISION SIGN)
    #[serde(rename = "/")]
    Div,
    /// `^`
    #[serde(rename = "^")]
    Pow,
}

/// A parenthesis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Paren {
    /// `(`
    #[serde(rename = "(")]
    Open,
    /// `)`
    #[serde(rename = ")")]
    Close,
}

/// One expression token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Token {
    /// A number literal.
    #[serde(rename = "n")]
    Num(Dec),
    /// A binary operator.
    #[serde(rename = "op")]
    Op(BinOp),
    /// A function or constant name (`sin`, `ln`, `pi`, `x` …), ASCII
    /// lowercase letters and digits, starting with a letter.
    #[serde(rename = "fn")]
    Ident(String),
    /// A parenthesis.
    #[serde(rename = "p")]
    Paren(Paren),
}

/// Why tokenizing failed, with the byte span of the offending text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenError {
    /// Stable code: `invalid_input`, `too_long` or `too_many_tokens`.
    pub code: &'static str,
    /// Byte offset where the problem starts.
    pub start: usize,
    /// Byte offset just after it.
    pub end: usize,
}

fn err(code: &'static str, start: usize, end: usize) -> TokenError {
    TokenError { code, start, end }
}

/// Longest identifier accepted, in bytes.
const MAX_IDENT_BYTES: usize = 16;

/// Splits expression text into tokens. Accepts ASCII operators and the
/// display signs U+2212, U+00D7 and U+00F7; whitespace separates tokens.
/// Numbers are parsed by [`Dec::parse`] (a unary minus is a separate
/// `Sub` token: the parser decides whether it is unary).
pub fn tokenize(text: &str) -> Result<Vec<Token>, TokenError> {
    if text.len() > MAX_EXPR_BYTES {
        return Err(err("too_long", 0, text.len()));
    }
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some(&(start, c)) = chars.peek() {
        if out.len() >= MAX_EXPR_TOKENS {
            return Err(err("too_many_tokens", start, text.len()));
        }
        let simple = match c {
            '+' => Some(Token::Op(BinOp::Add)),
            '-' | '\u{2212}' => Some(Token::Op(BinOp::Sub)),
            '*' | '\u{00D7}' => Some(Token::Op(BinOp::Mul)),
            '/' | '\u{00F7}' => Some(Token::Op(BinOp::Div)),
            '^' => Some(Token::Op(BinOp::Pow)),
            '(' => Some(Token::Paren(Paren::Open)),
            ')' => Some(Token::Paren(Paren::Close)),
            _ => None,
        };
        if let Some(tok) = simple {
            out.push(tok);
            chars.next();
            continue;
        }
        if c.is_ascii_whitespace() {
            chars.next();
            continue;
        }
        if c.is_ascii_digit() || c == '.' {
            let mut end = start;
            let mut prev = '\0';
            while let Some(&(i, d)) = chars.peek() {
                let in_exponent_sign = (d == '+' || d == '-') && (prev == 'e' || prev == 'E');
                if d.is_ascii_digit() || d == '.' || d == 'e' || d == 'E' || in_exponent_sign {
                    end = i + d.len_utf8();
                    prev = d;
                    chars.next();
                } else {
                    break;
                }
            }
            let literal = &text[start..end];
            let value = Dec::parse(literal).map_err(|_| err("invalid_input", start, end))?;
            out.push(Token::Num(value));
            continue;
        }
        if c.is_ascii_lowercase() {
            let mut end = start;
            while let Some(&(i, d)) = chars.peek() {
                if d.is_ascii_lowercase() || d.is_ascii_digit() {
                    end = i + 1;
                    chars.next();
                } else {
                    break;
                }
            }
            if end - start > MAX_IDENT_BYTES {
                return Err(err("invalid_input", start, end));
            }
            out.push(Token::Ident(text[start..end].to_string()));
            continue;
        }
        return Err(err("invalid_input", start, start + c.len_utf8()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(s: &str) -> Token {
        Token::Num(Dec::parse(s).unwrap())
    }

    #[test]
    fn tokenizes_numbers_operators_names_and_parens() {
        assert_eq!(
            tokenize("2+3\u{00D7}4").unwrap(),
            vec![
                n("2"),
                Token::Op(BinOp::Add),
                n("3"),
                Token::Op(BinOp::Mul),
                n("4")
            ]
        );
        assert_eq!(
            tokenize(" sin(1.5e-3) \u{2212} pi ").unwrap(),
            vec![
                Token::Ident("sin".into()),
                Token::Paren(Paren::Open),
                n("0.0015"),
                Token::Paren(Paren::Close),
                Token::Op(BinOp::Sub),
                Token::Ident("pi".into()),
            ]
        );
        assert_eq!(tokenize("").unwrap(), vec![]);
    }

    #[test]
    fn errors_carry_spans_and_never_panic() {
        assert_eq!(tokenize("1+$").unwrap_err(), err("invalid_input", 2, 3));
        assert_eq!(tokenize("1..2").unwrap_err(), err("invalid_input", 0, 4));
        assert_eq!(
            tokenize("2\u{00A7}").unwrap_err(),
            err("invalid_input", 1, 3)
        );
        assert_eq!(tokenize("Sin").unwrap_err().code, "invalid_input");
        assert_eq!(
            tokenize(&"1".repeat(MAX_EXPR_BYTES + 1)).unwrap_err().code,
            "too_long"
        );
        assert_eq!(
            tokenize(&"1+".repeat(MAX_EXPR_TOKENS)).unwrap_err().code,
            "too_many_tokens"
        );
    }

    #[test]
    fn history_token_form_round_trips() {
        let tokens = tokenize("(1+2)^3").unwrap();
        let json = serde_json::to_string(&tokens).unwrap();
        assert_eq!(
            json,
            r#"[{"p":"("},{"n":"1"},{"op":"+"},{"n":"2"},{"p":")"},{"op":"^"},{"n":"3"}]"#
        );
        let back: Vec<Token> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, tokens);
    }
}
