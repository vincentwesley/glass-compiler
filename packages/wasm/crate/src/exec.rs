//! Semantics of the numeric instructions and of memory loads and stores.

use crate::float::*;
use crate::module::Value::{self, F32, F64, I32, I64};
use crate::runtime::Trap;

fn trap(m: &str) -> Trap {
    Trap::new(m)
}

fn trunc_err(e: TruncError) -> Trap {
    match e {
        TruncError::Invalid => trap("invalid conversion to integer"),
        TruncError::Overflow => trap("integer overflow"),
    }
}

macro_rules! pop {
    ($s:expr, I32) => {
        match $s.pop() { Some(I32(v)) => v, _ => unreachable!() }
    };
    ($s:expr, I64) => {
        match $s.pop() { Some(I64(v)) => v, _ => unreachable!() }
    };
    ($s:expr, F32) => {
        match $s.pop() { Some(F32(v)) => v, _ => unreachable!() }
    };
    ($s:expr, F64) => {
        match $s.pop() { Some(F64(v)) => v, _ => unreachable!() }
    };
}

fn b(v: bool) -> Value {
    I32(v as i32)
}

/// Runs numeric instruction `op` (0x45..=0xbf) on the value stack.
pub fn exec_num(s: &mut Vec<Value>, op: u8) -> Result<(), Trap> {
    let r = match op {
        // i32 tests and comparisons
        0x45 => b(pop!(s, I32) == 0),
        0x46..=0x4f => {
            let y = pop!(s, I32);
            let x = pop!(s, I32);
            let (ux, uy) = (x as u32, y as u32);
            b(match op {
                0x46 => x == y,
                0x47 => x != y,
                0x48 => x < y,
                0x49 => ux < uy,
                0x4a => x > y,
                0x4b => ux > uy,
                0x4c => x <= y,
                0x4d => ux <= uy,
                0x4e => x >= y,
                _ => ux >= uy,
            })
        }
        0x50 => b(pop!(s, I64) == 0),
        0x51..=0x5a => {
            let y = pop!(s, I64);
            let x = pop!(s, I64);
            let (ux, uy) = (x as u64, y as u64);
            b(match op {
                0x51 => x == y,
                0x52 => x != y,
                0x53 => x < y,
                0x54 => ux < uy,
                0x55 => x > y,
                0x56 => ux > uy,
                0x57 => x <= y,
                0x58 => ux <= uy,
                0x59 => x >= y,
                _ => ux >= uy,
            })
        }
        0x5b..=0x60 => {
            let y = f32::from_bits(pop!(s, F32));
            let x = f32::from_bits(pop!(s, F32));
            b(match op {
                0x5b => x == y,
                0x5c => x != y,
                0x5d => x < y,
                0x5e => x > y,
                0x5f => x <= y,
                _ => x >= y,
            })
        }
        0x61..=0x66 => {
            let y = f64::from_bits(pop!(s, F64));
            let x = f64::from_bits(pop!(s, F64));
            b(match op {
                0x61 => x == y,
                0x62 => x != y,
                0x63 => x < y,
                0x64 => x > y,
                0x65 => x <= y,
                _ => x >= y,
            })
        }
        // i32 arithmetic
        0x67 => I32(pop!(s, I32).leading_zeros() as i32),
        0x68 => I32(pop!(s, I32).trailing_zeros() as i32),
        0x69 => I32(pop!(s, I32).count_ones() as i32),
        0x6a..=0x78 => {
            let y = pop!(s, I32);
            let x = pop!(s, I32);
            I32(match op {
                0x6a => x.wrapping_add(y),
                0x6b => x.wrapping_sub(y),
                0x6c => x.wrapping_mul(y),
                0x6d => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    if x == i32::MIN && y == -1 {
                        return Err(trap("integer overflow"));
                    }
                    x / y
                }
                0x6e => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    ((x as u32) / (y as u32)) as i32
                }
                0x6f => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    x.wrapping_rem(y)
                }
                0x70 => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    ((x as u32) % (y as u32)) as i32
                }
                0x71 => x & y,
                0x72 => x | y,
                0x73 => x ^ y,
                0x74 => x.wrapping_shl(y as u32),
                0x75 => x.wrapping_shr(y as u32),
                0x76 => (x as u32).wrapping_shr(y as u32) as i32,
                0x77 => x.rotate_left(y as u32 % 32),
                _ => x.rotate_right(y as u32 % 32),
            })
        }
        // i64 arithmetic
        0x79 => I64(pop!(s, I64).leading_zeros() as i64),
        0x7a => I64(pop!(s, I64).trailing_zeros() as i64),
        0x7b => I64(pop!(s, I64).count_ones() as i64),
        0x7c..=0x8a => {
            let y = pop!(s, I64);
            let x = pop!(s, I64);
            I64(match op {
                0x7c => x.wrapping_add(y),
                0x7d => x.wrapping_sub(y),
                0x7e => x.wrapping_mul(y),
                0x7f => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    if x == i64::MIN && y == -1 {
                        return Err(trap("integer overflow"));
                    }
                    x / y
                }
                0x80 => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    ((x as u64) / (y as u64)) as i64
                }
                0x81 => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    x.wrapping_rem(y)
                }
                0x82 => {
                    if y == 0 {
                        return Err(trap("integer divide by zero"));
                    }
                    ((x as u64) % (y as u64)) as i64
                }
                0x83 => x & y,
                0x84 => x | y,
                0x85 => x ^ y,
                0x86 => x.wrapping_shl(y as u32),
                0x87 => x.wrapping_shr(y as u32),
                0x88 => (x as u64).wrapping_shr(y as u32) as i64,
                0x89 => x.rotate_left((y as u64 % 64) as u32),
                _ => x.rotate_right((y as u64 % 64) as u32),
            })
        }
        // f32
        0x8b => F32(pop!(s, F32) & 0x7fff_ffff),
        0x8c => F32(pop!(s, F32) ^ 0x8000_0000),
        0x8d => F32(unary32(pop!(s, F32), f32::ceil)),
        0x8e => F32(unary32(pop!(s, F32), f32::floor)),
        0x8f => F32(unary32(pop!(s, F32), f32::trunc)),
        0x90 => F32(unary32(pop!(s, F32), f32::round_ties_even)),
        0x91 => F32(sqrt32(pop!(s, F32))),
        0x92..=0x98 => {
            let y = pop!(s, F32);
            let x = pop!(s, F32);
            F32(match op {
                0x92 => binary32(x, y, |a, b| a + b),
                0x93 => binary32(x, y, |a, b| a - b),
                0x94 => binary32(x, y, |a, b| a * b),
                0x95 => binary32(x, y, |a, b| a / b),
                0x96 => min32(x, y),
                0x97 => max32(x, y),
                _ => (x & 0x7fff_ffff) | (y & 0x8000_0000),
            })
        }
        // f64
        0x99 => F64(pop!(s, F64) & 0x7fff_ffff_ffff_ffff),
        0x9a => F64(pop!(s, F64) ^ 0x8000_0000_0000_0000),
        0x9b => F64(unary64(pop!(s, F64), f64::ceil)),
        0x9c => F64(unary64(pop!(s, F64), f64::floor)),
        0x9d => F64(unary64(pop!(s, F64), f64::trunc)),
        0x9e => F64(unary64(pop!(s, F64), f64::round_ties_even)),
        0x9f => F64(sqrt64(pop!(s, F64))),
        0xa0..=0xa6 => {
            let y = pop!(s, F64);
            let x = pop!(s, F64);
            F64(match op {
                0xa0 => binary64(x, y, |a, b| a + b),
                0xa1 => binary64(x, y, |a, b| a - b),
                0xa2 => binary64(x, y, |a, b| a * b),
                0xa3 => binary64(x, y, |a, b| a / b),
                0xa4 => min64(x, y),
                0xa5 => max64(x, y),
                _ => (x & 0x7fff_ffff_ffff_ffff) | (y & 0x8000_0000_0000_0000),
            })
        }
        // conversions
        0xa7 => I32(pop!(s, I64) as i32),
        0xa8 => I32(trunc_i32_s(f32::from_bits(pop!(s, F32)) as f64).map_err(trunc_err)?),
        0xa9 => I32(trunc_i32_u(f32::from_bits(pop!(s, F32)) as f64).map_err(trunc_err)?),
        0xaa => I32(trunc_i32_s(f64::from_bits(pop!(s, F64))).map_err(trunc_err)?),
        0xab => I32(trunc_i32_u(f64::from_bits(pop!(s, F64))).map_err(trunc_err)?),
        0xac => I64(pop!(s, I32) as i64),
        0xad => I64(pop!(s, I32) as u32 as i64),
        0xae => I64(trunc_i64_s(f32::from_bits(pop!(s, F32)) as f64).map_err(trunc_err)?),
        0xaf => I64(trunc_i64_u(f32::from_bits(pop!(s, F32)) as f64).map_err(trunc_err)?),
        0xb0 => I64(trunc_i64_s(f64::from_bits(pop!(s, F64))).map_err(trunc_err)?),
        0xb1 => I64(trunc_i64_u(f64::from_bits(pop!(s, F64))).map_err(trunc_err)?),
        0xb2 => F32((pop!(s, I32) as f32).to_bits()),
        0xb3 => F32((pop!(s, I32) as u32 as f32).to_bits()),
        0xb4 => F32((pop!(s, I64) as f32).to_bits()),
        0xb5 => F32((pop!(s, I64) as u64 as f32).to_bits()),
        0xb6 => F32(demote(pop!(s, F64))),
        0xb7 => F64((pop!(s, I32) as f64).to_bits()),
        0xb8 => F64((pop!(s, I32) as u32 as f64).to_bits()),
        0xb9 => F64((pop!(s, I64) as f64).to_bits()),
        0xba => F64((pop!(s, I64) as u64 as f64).to_bits()),
        0xbb => F64(promote(pop!(s, F32))),
        0xbc => I32(pop!(s, F32) as i32),
        0xbd => I64(pop!(s, F64) as i64),
        0xbe => F32(pop!(s, I32) as u32),
        0xbf => F64(pop!(s, I64) as u64),
        _ => unreachable!("not a numeric opcode: {op:#x}"),
    };
    s.push(r);
    Ok(())
}

/// The bytes a memory access touches, or the trap if they're out of bounds.
fn range(len: usize, addr: i32, offset: u32, n: usize) -> Result<std::ops::Range<usize>, Trap> {
    let ea = addr as u32 as u64 + offset as u64;
    if ea + n as u64 > len as u64 {
        return Err(trap("out of bounds memory access"));
    }
    Ok(ea as usize..ea as usize + n)
}

pub fn load(mem: &[u8], op: u8, addr: i32, offset: u32) -> Result<Value, Trap> {
    let width = crate::opcodes::mem_op(op).unwrap().bytes as usize;
    let r = range(mem.len(), addr, offset, width)?;
    let mut buf = [0u8; 8];
    buf[..width].copy_from_slice(&mem[r]);
    let raw = u64::from_le_bytes(buf);
    Ok(match op {
        0x28 => I32(raw as u32 as i32),
        0x29 => I64(raw as i64),
        0x2a => F32(raw as u32),
        0x2b => F64(raw),
        0x2c => I32(raw as u8 as i8 as i32),
        0x2d => I32(raw as u8 as i32),
        0x2e => I32(raw as u16 as i16 as i32),
        0x2f => I32(raw as u16 as i32),
        0x30 => I64(raw as u8 as i8 as i64),
        0x31 => I64(raw as u8 as i64),
        0x32 => I64(raw as u16 as i16 as i64),
        0x33 => I64(raw as u16 as i64),
        0x34 => I64(raw as u32 as i32 as i64),
        _ => I64(raw as u32 as i64),
    })
}

pub fn store(mem: &mut [u8], op: u8, addr: i32, offset: u32, v: Value) -> Result<(), Trap> {
    let width = crate::opcodes::mem_op(op).unwrap().bytes as usize;
    let r = range(mem.len(), addr, offset, width)?;
    let raw: u64 = match v {
        I32(x) => x as u32 as u64,
        I64(x) => x as u64,
        F32(x) => x as u64,
        F64(x) => x,
    };
    mem[r].copy_from_slice(&raw.to_le_bytes()[..width]);
    Ok(())
}
