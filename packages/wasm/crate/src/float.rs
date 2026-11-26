//! Float details WebAssembly is strict about: parsing literals (decimal, hex,
//! `inf`, `nan:0x…`) with correct rounding, NaN propagation, min/max with
//! signed zeros, ties-to-even rounding and trapping conversions.

pub const F32_QUIET: u32 = 0x0040_0000;
pub const F64_QUIET: u64 = 0x0008_0000_0000_0000;
pub const F32_CANON: u32 = 0x7fc0_0000;
pub const F64_CANON: u64 = 0x7ff8_0000_0000_0000;

/// Bit layout of a binary float format.
#[derive(Clone, Copy)]
pub struct Format {
    /// Significand bits including the hidden bit (24 or 53).
    pub precision: i32,
    pub exp_bits: u32,
}

pub const F32: Format = Format {
    precision: 24,
    exp_bits: 8,
};
pub const F64: Format = Format {
    precision: 53,
    exp_bits: 11,
};

impl Format {
    fn bias(self) -> i32 {
        (1 << (self.exp_bits - 1)) - 1
    }
    fn sign_bit(self) -> u64 {
        1u64 << (self.precision - 1 + self.exp_bits as i32)
    }
    fn exp_mask(self) -> u64 {
        ((1u64 << self.exp_bits) - 1) << (self.precision - 1)
    }
    fn frac_mask(self) -> u64 {
        (1u64 << (self.precision - 1)) - 1
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum FloatError {
    Malformed,
    OutOfRange,
}

/// Parses a float literal of the text format (underscores allowed between
/// digits) into raw bits for `fmt`.
pub fn parse(text: &str, fmt: Format) -> Result<u64, FloatError> {
    let (neg, body) = match text.as_bytes().first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    let sign = if neg { fmt.sign_bit() } else { 0 };
    if body == "inf" {
        return Ok(sign | fmt.exp_mask());
    }
    if body == "nan" {
        return Ok(sign | fmt.exp_mask() | (1u64 << (fmt.precision - 2)));
    }
    if let Some(payload) = body.strip_prefix("nan:0x") {
        let p = parse_hex_int(payload).ok_or(FloatError::Malformed)?;
        if p == 0 || p > fmt.frac_mask() {
            return Err(FloatError::OutOfRange);
        }
        return Ok(sign | fmt.exp_mask() | p);
    }
    if let Some(hex) = body.strip_prefix("0x") {
        return parse_hex_float(hex, fmt).map(|b| b | sign);
    }
    if !check_underscores_dec(body) || body.is_empty() || !body.as_bytes()[0].is_ascii_digit() {
        return Err(FloatError::Malformed);
    }
    let clean: String = body.chars().filter(|&c| c != '_').collect();
    if !clean
        .bytes()
        .all(|c| c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-'))
    {
        return Err(FloatError::Malformed);
    }
    let bits = if fmt.precision == 24 {
        let v: f32 = clean.parse().map_err(|_| FloatError::Malformed)?;
        if v.is_infinite() {
            return Err(FloatError::OutOfRange);
        }
        v.to_bits() as u64
    } else {
        let v: f64 = clean.parse().map_err(|_| FloatError::Malformed)?;
        if v.is_infinite() {
            return Err(FloatError::OutOfRange);
        }
        v.to_bits()
    };
    Ok(bits | sign)
}

/// In a decimal literal, underscores may only sit between two decimal digits.
pub fn check_underscores_dec(s: &str) -> bool {
    let b = s.as_bytes();
    b.iter().enumerate().all(|(i, &c)| {
        c != b'_'
            || (i > 0 && i + 1 < b.len() && b[i - 1].is_ascii_digit() && b[i + 1].is_ascii_digit())
    })
}

/// In a hex literal, underscores may only sit between two hex digits.
pub fn check_underscores(s: &str) -> bool {
    let b = s.as_bytes();
    for (i, &c) in b.iter().enumerate() {
        if c == b'_' {
            let ok = i > 0
                && i + 1 < b.len()
                && b[i - 1].is_ascii_hexdigit()
                && b[i + 1].is_ascii_hexdigit();
            if !ok {
                return false;
            }
        }
    }
    true
}

fn parse_hex_int(s: &str) -> Option<u64> {
    if s.is_empty() || !check_underscores(s) {
        return None;
    }
    let mut v: u64 = 0;
    for c in s.chars().filter(|&c| c != '_') {
        let d = c.to_digit(16)? as u64;
        v = v.checked_mul(16)?.checked_add(d)?;
    }
    Some(v)
}

/// `hex` is what follows `0x`: hexdigits [. hexdigits] [p [+-] decdigits].
fn parse_hex_float(hex: &str, fmt: Format) -> Result<u64, FloatError> {
    let (mant, exp) = match hex.find(['p', 'P']) {
        Some(i) => (&hex[..i], Some(&hex[i + 1..])),
        None => (hex, None),
    };
    let (int_part, frac_part) = match mant.find('.') {
        Some(i) => (&mant[..i], &mant[i + 1..]),
        None => (mant, ""),
    };
    if int_part.is_empty()
        || !check_underscores(int_part)
        || (!frac_part.is_empty() && !check_underscores(frac_part))
    {
        return Err(FloatError::Malformed);
    }
    // value = m * 2^e, with digits past 60 bits folded into `sticky`.
    let mut m: u64 = 0;
    let mut e: i64 = 0;
    let mut sticky = false;
    for (i, part) in [int_part, frac_part].iter().enumerate() {
        for c in part.chars().filter(|&c| c != '_') {
            let d = c.to_digit(16).ok_or(FloatError::Malformed)? as u64;
            if m < (1u64 << 59) {
                m = m * 16 + d;
                if i == 1 {
                    e -= 4;
                }
            } else {
                sticky |= d != 0;
                if i == 0 {
                    e += 4;
                }
            }
        }
    }
    if let Some(exp) = exp {
        let (eneg, digits) = match exp.as_bytes().first() {
            Some(b'-') => (true, &exp[1..]),
            Some(b'+') => (false, &exp[1..]),
            _ => (false, exp),
        };
        if digits.is_empty() || !check_underscores(digits) {
            return Err(FloatError::Malformed);
        }
        let mut x: i64 = 0;
        for c in digits.chars().filter(|&c| c != '_') {
            let d = c.to_digit(10).ok_or(FloatError::Malformed)? as i64;
            x = (x * 10 + d).min(1 << 40); // saturate: anything this big over/underflows anyway
        }
        e += if eneg { -x } else { x };
    }
    if m == 0 {
        return Ok(0);
    }
    round_to_format(m, e, sticky, fmt)
}

/// Rounds `m * 2^e` (plus a sticky "something nonzero below m") to the nearest
/// value of `fmt`, ties to even. Errors when it rounds to infinity.
pub fn round_to_format(m: u64, e: i64, sticky: bool, fmt: Format) -> Result<u64, FloatError> {
    let lz = m.leading_zeros() as i64;
    let m = m << lz;
    let e = e - lz;
    // value = 1.xxx * 2^big_e
    let big_e = e + 63;
    let p = fmt.precision as i64;
    let emin = 1 - fmt.bias() as i64;
    let emax = fmt.bias() as i64;
    let keep = if big_e < emin { p - (emin - big_e) } else { p };
    let shift = 64 - keep; // >= 11
    let (mut kept, round_up) = if shift > 64 {
        (0u64, false)
    } else {
        let kept = if shift == 64 { 0 } else { m >> shift };
        let rem = if shift == 64 {
            m
        } else {
            m & ((1u64 << shift) - 1)
        };
        let half = 1u64 << (shift - 1);
        let up = rem > half || (rem == half && (sticky || kept & 1 == 1));
        (kept, up)
    };
    if round_up {
        kept += 1;
    }
    if big_e < emin {
        // Subnormal (or rounded up into the smallest normal, which the same bits express).
        return Ok(kept);
    }
    let mut exp = big_e;
    if kept == 1u64 << p {
        kept >>= 1;
        exp += 1;
    }
    if exp > emax {
        return Err(FloatError::OutOfRange);
    }
    let biased = (exp + fmt.bias() as i64) as u64;
    Ok((biased << (p - 1)) | (kept & fmt.frac_mask()))
}

pub fn fmt_f32(bits: u32) -> String {
    let v = f32::from_bits(bits);
    if v.is_nan() {
        let sign = if bits >> 31 == 1 { "-" } else { "" };
        let payload = bits & 0x007f_ffff;
        if payload == F32_QUIET {
            format!("{sign}nan")
        } else {
            format!("{sign}nan:0x{payload:x}")
        }
    } else if v.is_infinite() {
        if v < 0.0 {
            "-inf".into()
        } else {
            "inf".into()
        }
    } else {
        format!("{v:?}")
    }
}

pub fn fmt_f64(bits: u64) -> String {
    let v = f64::from_bits(bits);
    if v.is_nan() {
        let sign = if bits >> 63 == 1 { "-" } else { "" };
        let payload = bits & 0x000f_ffff_ffff_ffff;
        if payload == F64_QUIET {
            format!("{sign}nan")
        } else {
            format!("{sign}nan:0x{payload:x}")
        }
    } else if v.is_infinite() {
        if v < 0.0 {
            "-inf".into()
        } else {
            "inf".into()
        }
    } else {
        format!("{v:?}")
    }
}

pub fn is_canonical_nan32(bits: u32) -> bool {
    bits & 0x7fff_ffff == F32_CANON
}
pub fn is_canonical_nan64(bits: u64) -> bool {
    bits & 0x7fff_ffff_ffff_ffff == F64_CANON
}
pub fn is_arithmetic_nan32(bits: u32) -> bool {
    f32::from_bits(bits).is_nan() && bits & F32_QUIET != 0
}
pub fn is_arithmetic_nan64(bits: u64) -> bool {
    f64::from_bits(bits).is_nan() && bits & F64_QUIET != 0
}

/// min/max: NaN in gives a quiet NaN out (canonical stays canonical), and -0 < +0.
pub fn min32(a: u32, b: u32) -> u32 {
    let (x, y) = (f32::from_bits(a), f32::from_bits(b));
    if x.is_nan() {
        a | F32_QUIET
    } else if y.is_nan() {
        b | F32_QUIET
    } else if x == y {
        a | b // equal: only the zeros differ, and -0 wins (sign bit set in either)
    } else if x < y {
        a
    } else {
        b
    }
}
pub fn max32(a: u32, b: u32) -> u32 {
    let (x, y) = (f32::from_bits(a), f32::from_bits(b));
    if x.is_nan() {
        a | F32_QUIET
    } else if y.is_nan() {
        b | F32_QUIET
    } else if x == y {
        a & b // +0 wins
    } else if x > y {
        a
    } else {
        b
    }
}
pub fn min64(a: u64, b: u64) -> u64 {
    let (x, y) = (f64::from_bits(a), f64::from_bits(b));
    if x.is_nan() {
        a | F64_QUIET
    } else if y.is_nan() {
        b | F64_QUIET
    } else if x == y {
        a | b
    } else if x < y {
        a
    } else {
        b
    }
}
pub fn max64(a: u64, b: u64) -> u64 {
    let (x, y) = (f64::from_bits(a), f64::from_bits(b));
    if x.is_nan() {
        a | F64_QUIET
    } else if y.is_nan() {
        b | F64_QUIET
    } else if x == y {
        a & b
    } else if x > y {
        a
    } else {
        b
    }
}

/// Unary rounding ops keep NaN payloads but quiet them.
pub fn unary32(bits: u32, f: impl Fn(f32) -> f32) -> u32 {
    let v = f32::from_bits(bits);
    if v.is_nan() {
        bits | F32_QUIET
    } else {
        f(v).to_bits()
    }
}
pub fn unary64(bits: u64, f: impl Fn(f64) -> f64) -> u64 {
    let v = f64::from_bits(bits);
    if v.is_nan() {
        bits | F64_QUIET
    } else {
        f(v).to_bits()
    }
}

/// Binary arithmetic with WebAssembly's NaN rule: a NaN operand propagates (quieted);
/// a NaN produced from non-NaN operands is canonical.
pub fn binary32(a: u32, b: u32, f: impl Fn(f32, f32) -> f32) -> u32 {
    let (x, y) = (f32::from_bits(a), f32::from_bits(b));
    if x.is_nan() {
        return a | F32_QUIET;
    }
    if y.is_nan() {
        return b | F32_QUIET;
    }
    let r = f(x, y);
    if r.is_nan() {
        F32_CANON
    } else {
        r.to_bits()
    }
}
pub fn binary64(a: u64, b: u64, f: impl Fn(f64, f64) -> f64) -> u64 {
    let (x, y) = (f64::from_bits(a), f64::from_bits(b));
    if x.is_nan() {
        return a | F64_QUIET;
    }
    if y.is_nan() {
        return b | F64_QUIET;
    }
    let r = f(x, y);
    if r.is_nan() {
        F64_CANON
    } else {
        r.to_bits()
    }
}

pub fn sqrt32(bits: u32) -> u32 {
    let v = f32::from_bits(bits);
    if v.is_nan() {
        bits | F32_QUIET
    } else {
        let r = v.sqrt();
        if r.is_nan() {
            F32_CANON
        } else {
            r.to_bits()
        }
    }
}
pub fn sqrt64(bits: u64) -> u64 {
    let v = f64::from_bits(bits);
    if v.is_nan() {
        bits | F64_QUIET
    } else {
        let r = v.sqrt();
        if r.is_nan() {
            F64_CANON
        } else {
            r.to_bits()
        }
    }
}

pub fn demote(bits: u64) -> u32 {
    let v = f64::from_bits(bits);
    if v.is_nan() {
        // Keep the sign and the top payload bits, quieted.
        let sign = ((bits >> 63) as u32) << 31;
        let payload = ((bits >> 29) as u32) & 0x007f_ffff;
        sign | 0x7f80_0000 | F32_QUIET | payload
    } else {
        (v as f32).to_bits()
    }
}
pub fn promote(bits: u32) -> u64 {
    let v = f32::from_bits(bits);
    if v.is_nan() {
        let sign = ((bits >> 31) as u64) << 63;
        let payload = ((bits & 0x007f_ffff) as u64) << 29;
        sign | 0x7ff0_0000_0000_0000 | F64_QUIET | payload
    } else {
        (v as f64).to_bits()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum TruncError {
    /// NaN: "invalid conversion to integer"
    Invalid,
    /// Out of range: "integer overflow"
    Overflow,
}

/// Truncates toward zero and checks the result fits in [lo, hi] (given as exact f64 bounds,
/// hi exclusive).
fn trunc_checked(v: f64, lo_inclusive: f64, hi_exclusive: f64) -> Result<f64, TruncError> {
    if v.is_nan() {
        return Err(TruncError::Invalid);
    }
    let t = v.trunc();
    if t >= lo_inclusive && t < hi_exclusive {
        Ok(t)
    } else {
        Err(TruncError::Overflow)
    }
}

pub fn trunc_i32_s(v: f64) -> Result<i32, TruncError> {
    trunc_checked(v, -2147483648.0, 2147483648.0).map(|t| t as i32)
}
pub fn trunc_i32_u(v: f64) -> Result<i32, TruncError> {
    trunc_checked(v, -0.0, 4294967296.0).map(|t| t as u32 as i32)
}
pub fn trunc_i64_s(v: f64) -> Result<i64, TruncError> {
    trunc_checked(v, -9223372036854775808.0, 9223372036854775808.0).map(|t| t as i64)
}
pub fn trunc_i64_u(v: f64) -> Result<i64, TruncError> {
    trunc_checked(v, -0.0, 18446744073709551616.0).map(|t| t as u64 as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p32(s: &str) -> u32 {
        parse(s, F32).unwrap() as u32
    }
    fn p64(s: &str) -> u64 {
        parse(s, F64).unwrap()
    }

    #[test]
    fn decimal_and_special_literals() {
        assert_eq!(f32::from_bits(p32("1.5")), 1.5);
        assert_eq!(f64::from_bits(p64("-1_000.25e1")), -10002.5);
        assert_eq!(p32("-0"), 0x8000_0000);
        assert_eq!(p32("inf"), 0x7f80_0000);
        assert_eq!(p32("-nan"), 0xffc0_0000);
        assert_eq!(p32("nan:0x200000"), 0x7fa0_0000);
        assert_eq!(p64("nan:0x1"), 0x7ff0_0000_0000_0001);
        assert_eq!(parse("1e39", F32), Err(FloatError::OutOfRange));
        assert_eq!(parse("nan:0x0", F32), Err(FloatError::OutOfRange));
        assert_eq!(parse("nan:0x800000", F32), Err(FloatError::OutOfRange));
        assert_eq!(parse("1__0", F32), Err(FloatError::Malformed));
        assert_eq!(parse("_1", F32), Err(FloatError::Malformed));
        assert_eq!(parse("1_e1", F32), Err(FloatError::Malformed));
        assert_eq!(parse("1.0e_1", F64), Err(FloatError::Malformed));
    }

    #[test]
    fn hex_literals_round_correctly() {
        assert_eq!(f32::from_bits(p32("0x1p-1")), 0.5);
        assert_eq!(f32::from_bits(p32("0x1.8p+1")), 3.0);
        assert_eq!(p32("0x1p-149"), 1); // smallest subnormal
        assert_eq!(p32("0x1p-150"), 0); // exactly half the smallest: ties to even -> 0
        assert_eq!(p32("0x1.000002p-150"), 1); // just above half -> rounds up
        assert_eq!(p32("0x1.fffffep127"), 0x7f7f_ffff);
        assert_eq!(parse("0x1.ffffffp127", F32), Err(FloatError::OutOfRange));
        assert_eq!(p32("0x1.0000010p0"), 0x3f80_0000); // tie -> even (down)
        assert_eq!(p32("0x1.0000030p0"), 0x3f80_0002); // tie -> even (up)
        assert_eq!(p32("0x1.00000100000000000001p0"), 0x3f80_0001); // just above the tie, far digits
        assert_eq!(p64("0x1p-1074"), 1);
        assert_eq!(p64("0x1.fffffffffffff8p-1023"), 0x0010_0000_0000_0000); // rounds up into the smallest normal
        assert_eq!(
            p64("0x.8p1".replace(".8", "0.8").as_str()),
            1.0f64.to_bits()
        );
    }

    #[test]
    fn min_max_and_conversions() {
        assert_eq!(min32(0x8000_0000, 0), 0x8000_0000);
        assert_eq!(max32(0x8000_0000, 0), 0);
        assert!(is_canonical_nan32(min32(F32_CANON, 0)));
        assert_eq!(trunc_i32_s(-2147483648.9), Ok(-2147483648));
        assert_eq!(trunc_i32_s(2147483648.0), Err(TruncError::Overflow));
        assert_eq!(trunc_i32_u(-0.9), Ok(0));
        assert_eq!(trunc_i32_u(-1.0), Err(TruncError::Overflow));
        assert_eq!(trunc_i64_u(f64::NAN), Err(TruncError::Invalid));
    }
}
