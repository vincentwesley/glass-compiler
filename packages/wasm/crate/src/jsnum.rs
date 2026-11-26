//! JavaScript's number-to-text rules, so a Pane program prints exactly the same
//! digits in Glass Wasm as in Glass Compiler's own VM (which runs in JavaScript).
//!
//! Pane prints a number `v` as `String(v)` when it is an integer and as
//! `String(Number(v.toPrecision(12)))` otherwise. This module implements both
//! steps from the ECMAScript spec: `Number::toString` (shortest round-trip digits,
//! laid out with JavaScript's rules) and `toPrecision` (exactly rounded, ties away
//! from zero).

/// ECMAScript `Number::toString(x)` for radix 10.
pub fn to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into(); // also -0
    }
    if x.is_infinite() {
        return if x < 0.0 {
            "-Infinity".into()
        } else {
            "Infinity".into()
        };
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // Shortest digits that round-trip, e.g. "1.2345e-7" -> digits "12345", exponent -7.
    let (digits, exp) = split_exp(&format!("{:e}", x.abs()));
    format!("{sign}{}", layout(&digits, exp + 1))
}

/// Splits Rust's `d.ddde±x` form into the digit string and the exponent.
fn split_exp(s: &str) -> (String, i32) {
    let (mant, exp) = s.split_once('e').expect("exponential form");
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    (
        digits.trim_end_matches('0').to_string().max("0".into()),
        exp.parse().expect("exponent"),
    )
}

/// ECMAScript's layout of `digits × 10^(n − k)` (k = number of digits).
fn layout(digits: &str, n: i32) -> String {
    let k = digits.len() as i32;
    if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e < 0 { '-' } else { '+' };
        if k == 1 {
            format!("{digits}e{sign}{}", e.abs())
        } else {
            format!("{}.{}e{sign}{}", &digits[..1], &digits[1..], e.abs())
        }
    }
}

/// `x.toPrecision(p)` read back as a number: x rounded to `p` significant digits,
/// with exact ties rounded away from zero (ECMAScript picks the larger `n`).
pub fn round_to_precision(x: f64, p: usize) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let neg = x < 0.0;
    let a = x.abs();
    // Rust rounds the exact binary value half-to-even; only an exact tie can differ.
    let mut rounded = format!("{:.*e}", p - 1, a);
    let (more, _) = split_exp_raw(&format!("{:.*e}", p, a));
    if more.as_bytes()[p] == b'5' {
        // Is the value exactly halfway? Look at its full decimal expansion.
        let (exact, _) = split_exp_raw(&format!("{:.800e}", a));
        if exact.as_bytes()[p] == b'5' && exact.as_bytes()[p + 1..].iter().all(|&c| c == b'0') {
            // A true tie: round the magnitude up (away from zero).
            let (base, e) = split_exp_raw(&format!("{:.800e}", a));
            let head = &base[..p];
            rounded = format!("{}e{e}", increment(head));
        }
    }
    let v: f64 = to_float(&rounded);
    if neg {
        -v
    } else {
        v
    }
}

/// Digits (with the decimal point removed, trailing zeros kept) and exponent.
fn split_exp_raw(s: &str) -> (String, i32) {
    let (mant, exp) = s.split_once('e').expect("exponential form");
    (
        mant.chars().filter(|c| *c != '.').collect(),
        exp.parse().expect("exponent"),
    )
}

/// Adds one to a decimal digit string, as a mantissa "d.ddd" (carry may add a digit).
fn increment(digits: &str) -> String {
    let mut d: Vec<u8> = digits.bytes().collect();
    let mut i = d.len();
    loop {
        if i == 0 {
            d.insert(0, b'1');
            break;
        }
        i -= 1;
        if d[i] == b'9' {
            d[i] = b'0';
        } else {
            d[i] += 1;
            break;
        }
    }
    // Back to d.ddd form: when a carry added a digit, the exponent is one higher,
    // which "1.000e(e+1)" and "10.00e(e)" both express; parse handles either.
    let s = String::from_utf8(d).unwrap();
    format!("{}.{}", &s[..1], &s[1..])
}

fn to_float(s: &str) -> f64 {
    // `rounded` is "d.ddde±x" or "d.ddde x" forms Rust can parse directly.
    s.parse().expect("a decimal number")
}

/// How Pane prints a number (Glass Compiler's `formatValue`).
pub fn pane_format(x: f64) -> String {
    if x.is_finite() && x.fract() == 0.0 {
        to_string(x)
    } else {
        to_string(round_to_precision(x, 12))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_layout() {
        assert_eq!(to_string(0.0), "0");
        assert_eq!(to_string(-0.0), "0");
        assert_eq!(to_string(42.0), "42");
        assert_eq!(to_string(-1.5), "-1.5");
        assert_eq!(to_string(1e21), "1e+21");
        assert_eq!(to_string(123456789012345680000.0), "123456789012345680000");
        assert_eq!(to_string(0.000001), "0.000001");
        assert_eq!(to_string(0.0000001), "1e-7");
        assert_eq!(to_string(1.5e-7), "1.5e-7");
        assert_eq!(to_string(f64::INFINITY), "Infinity");
        assert_eq!(to_string(f64::NAN), "NaN");
        assert_eq!(to_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(to_string(5e-324), "5e-324");
    }

    #[test]
    fn pane_number_format() {
        assert_eq!(pane_format(0.1 + 0.2), "0.3");
        assert_eq!(pane_format(1.0 / 3.0), "0.333333333333");
        assert_eq!(pane_format(7.0 / 2.0), "3.5");
        assert_eq!(pane_format(-2.0 / 3.0), "-0.666666666667");
        assert_eq!(pane_format(1e300 * 10.0), "1e+301");
        assert_eq!(pane_format(f64::INFINITY), "Infinity");
        // An exact tie at the 13th digit rounds away from zero, as toPrecision does.
        assert_eq!(pane_format(123456789012.5), "123456789013");
        assert_eq!(pane_format(-123456789012.5), "-123456789013");
        assert_eq!(pane_format(1234567890122.5), "1234567890120");
        assert_eq!(pane_format(0.5), "0.5");
    }
}
