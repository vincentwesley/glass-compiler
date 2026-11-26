//! Tokens and S-expressions of the WebAssembly text format (and `.wast` scripts).

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    /// keywords, numbers and other reserved words: `module`, `i32.add`, `0x10`, `offset=4`, `nan:0x1`
    Atom(String),
    /// `$name`
    Id(String),
    /// string contents as raw bytes
    Str(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Sexp {
    Tok(Tok, usize),
    /// `(` … `)` with the offset of the opening paren and the closing one
    List(Vec<Sexp>, usize, usize),
}

impl Sexp {
    pub fn offset(&self) -> usize {
        match self {
            Sexp::Tok(_, o) | Sexp::List(_, o, _) => *o,
        }
    }
    pub fn atom(&self) -> Option<&str> {
        match self {
            Sexp::Tok(Tok::Atom(a), _) => Some(a),
            _ => None,
        }
    }
    pub fn id(&self) -> Option<&str> {
        match self {
            Sexp::Tok(Tok::Id(a), _) => Some(a),
            _ => None,
        }
    }
    pub fn string(&self) -> Option<&[u8]> {
        match self {
            Sexp::Tok(Tok::Str(s), _) => Some(s),
            _ => None,
        }
    }
    pub fn list(&self) -> Option<&[Sexp]> {
        match self {
            Sexp::List(items, ..) => Some(items),
            _ => None,
        }
    }
    /// A list whose first element is the given keyword, e.g. `(param …)`.
    pub fn is_form(&self, keyword: &str) -> bool {
        matches!(self.list().and_then(|l| l.first()).and_then(|h| h.atom()), Some(k) if k == keyword)
    }
    pub fn head(&self) -> Option<&str> {
        self.list().and_then(|l| l.first()).and_then(|h| h.atom())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LexError {
    pub message: String,
    pub offset: usize,
}

fn is_idchar(c: u8) -> bool {
    c.is_ascii_alphanumeric() || b"!#$%&'*+-./:<=>?@\\^_`|~".contains(&c)
}

/// Splits source text into S-expressions. Comments (`;; …` and nested `(; … ;)`) are skipped.
pub fn parse_sexps(src: &str) -> Result<Vec<Sexp>, LexError> {
    let b = src.as_bytes();
    let mut i = 0;
    let mut stack: Vec<(Vec<Sexp>, usize)> = vec![(Vec::new(), 0)];
    let err = |message: &str, offset: usize| Err(LexError { message: message.to_string(), offset });
    while i < b.len() {
        let c = b[i];
        match c {
            b' ' | b'\t' | b'\n' | b'\r' => i += 1,
            b';' if b.get(i + 1) == Some(&b';') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'(' if b.get(i + 1) == Some(&b';') => {
                let start = i;
                let mut depth = 0;
                loop {
                    if i + 1 >= b.len() {
                        return err("unclosed comment", start);
                    }
                    if b[i] == b'(' && b[i + 1] == b';' {
                        depth += 1;
                        i += 2;
                    } else if b[i] == b';' && b[i + 1] == b')' {
                        depth -= 1;
                        i += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
            }
            b'(' => {
                stack.push((Vec::new(), i));
                i += 1;
            }
            b')' => {
                if stack.len() == 1 {
                    return err("unexpected )", i);
                }
                let (items, start) = stack.pop().unwrap();
                stack.last_mut().unwrap().0.push(Sexp::List(items, start, i));
                i += 1;
            }
            b'"' => {
                let start = i;
                i += 1;
                let mut s = Vec::new();
                loop {
                    let Some(&c) = b.get(i) else { return err("unclosed string", start) };
                    match c {
                        b'"' => {
                            i += 1;
                            break;
                        }
                        b'\\' => {
                            let Some(&e) = b.get(i + 1) else { return err("unclosed string", start) };
                            i += 2;
                            match e {
                                b'n' => s.push(b'\n'),
                                b't' => s.push(b'\t'),
                                b'r' => s.push(b'\r'),
                                b'"' => s.push(b'"'),
                                b'\'' => s.push(b'\''),
                                b'\\' => s.push(b'\\'),
                                b'u' => {
                                    if b.get(i) != Some(&b'{') {
                                        return err("malformed escape", i);
                                    }
                                    let close = b[i..].iter().position(|&c| c == b'}').map(|p| p + i);
                                    let Some(close) = close else { return err("malformed escape", i) };
                                    let hex = &src[i + 1..close];
                                    if hex.is_empty() || !crate::float::check_underscores(hex) {
                                        return err("malformed escape", i);
                                    }
                                    let digits: String = hex.chars().filter(|&c| c != '_').collect();
                                    let cp = u32::from_str_radix(&digits, 16).ok();
                                    let Some(ch) = cp.and_then(char::from_u32) else { return err("malformed escape", i) };
                                    let mut buf = [0u8; 4];
                                    s.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                                    i = close + 1;
                                }
                                h1 if h1.is_ascii_hexdigit() => {
                                    let Some(&h2) = b.get(i).filter(|c| c.is_ascii_hexdigit()) else { return err("malformed escape", i) };
                                    let v = (hex_val(h1) << 4) | hex_val(h2);
                                    s.push(v);
                                    i += 1;
                                }
                                _ => return err("malformed escape", i - 1),
                            }
                        }
                        c if c < 0x20 || c == 0x7f => return err("control character in string", i),
                        _ => {
                            s.push(c);
                            i += 1;
                        }
                    }
                }
                stack.last_mut().unwrap().0.push(Sexp::Tok(Tok::Str(s), start));
            }
            _ if is_idchar(c) => {
                let start = i;
                while i < b.len() && is_idchar(b[i]) {
                    i += 1;
                }
                let text = &src[start..i];
                let tok = if let Some(id) = text.strip_prefix('$') {
                    if id.is_empty() {
                        return err("empty identifier", start);
                    }
                    Tok::Id(id.to_string())
                } else {
                    Tok::Atom(text.to_string())
                };
                // A token must be followed by whitespace, a paren, a comment or the end.
                if let Some(&next) = b.get(i) {
                    if !matches!(next, b' ' | b'\t' | b'\n' | b'\r' | b'(' | b')' | b';') {
                        return err("unknown operator", start);
                    }
                }
                stack.last_mut().unwrap().0.push(Sexp::Tok(tok, start));
            }
            _ => return err("unexpected character", i),
        }
    }
    if stack.len() != 1 {
        return err("unclosed (", stack.last().unwrap().1);
    }
    Ok(stack.pop().unwrap().0)
}

fn hex_val(c: u8) -> u8 {
    (c as char).to_digit(16).unwrap() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nests_lists_and_skips_comments() {
        let s = parse_sexps("(module ;; hi\n (; nested (; deep ;) ;) (func $f (i32.const -1)))").unwrap();
        assert_eq!(s.len(), 1);
        let m = s[0].list().unwrap();
        assert_eq!(m[0].atom(), Some("module"));
        let f = m[1].list().unwrap();
        assert_eq!(f[1].id(), Some("f"));
        assert_eq!(f[2].list().unwrap()[1].atom(), Some("-1"));
    }

    #[test]
    fn decodes_string_escapes() {
        let s = parse_sexps(r#""a\n\41\u{1F600}\"""#).unwrap();
        assert_eq!(s[0].string().unwrap(), "a\nA😀\"".as_bytes());
        assert!(parse_sexps("\"\\q\"").is_err());
        assert!(parse_sexps(r#""tab\there""#).is_ok());
        assert!(parse_sexps("\"raw\ttab\"").is_err());
        assert!(parse_sexps("(a").is_err());
    }
}
