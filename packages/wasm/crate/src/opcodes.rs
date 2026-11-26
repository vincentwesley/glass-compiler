//! Names and signatures of the numeric, load and store instructions, indexed
//! by their binary opcode. One table drives the text parser, the binary
//! decoder, the validator and the debugger's instruction names.

use crate::module::ValType::{self, F32, F64, I32, I64};

/// A numeric instruction without immediates: `(opcode, name, params, result)`.
pub struct NumOp {
    pub code: u8,
    pub name: &'static str,
    pub params: &'static [ValType],
    pub result: ValType,
}

macro_rules! ops {
    ($( $code:literal $name:literal [$($p:ident),*] $r:ident ;)*) => {
        pub static NUM_OPS: &[NumOp] = &[ $( NumOp { code: $code, name: $name, params: &[$($p),*], result: $r }, )* ];
    };
}

ops! {
    0x45 "i32.eqz" [I32] I32;
    0x46 "i32.eq" [I32, I32] I32;
    0x47 "i32.ne" [I32, I32] I32;
    0x48 "i32.lt_s" [I32, I32] I32;
    0x49 "i32.lt_u" [I32, I32] I32;
    0x4a "i32.gt_s" [I32, I32] I32;
    0x4b "i32.gt_u" [I32, I32] I32;
    0x4c "i32.le_s" [I32, I32] I32;
    0x4d "i32.le_u" [I32, I32] I32;
    0x4e "i32.ge_s" [I32, I32] I32;
    0x4f "i32.ge_u" [I32, I32] I32;
    0x50 "i64.eqz" [I64] I32;
    0x51 "i64.eq" [I64, I64] I32;
    0x52 "i64.ne" [I64, I64] I32;
    0x53 "i64.lt_s" [I64, I64] I32;
    0x54 "i64.lt_u" [I64, I64] I32;
    0x55 "i64.gt_s" [I64, I64] I32;
    0x56 "i64.gt_u" [I64, I64] I32;
    0x57 "i64.le_s" [I64, I64] I32;
    0x58 "i64.le_u" [I64, I64] I32;
    0x59 "i64.ge_s" [I64, I64] I32;
    0x5a "i64.ge_u" [I64, I64] I32;
    0x5b "f32.eq" [F32, F32] I32;
    0x5c "f32.ne" [F32, F32] I32;
    0x5d "f32.lt" [F32, F32] I32;
    0x5e "f32.gt" [F32, F32] I32;
    0x5f "f32.le" [F32, F32] I32;
    0x60 "f32.ge" [F32, F32] I32;
    0x61 "f64.eq" [F64, F64] I32;
    0x62 "f64.ne" [F64, F64] I32;
    0x63 "f64.lt" [F64, F64] I32;
    0x64 "f64.gt" [F64, F64] I32;
    0x65 "f64.le" [F64, F64] I32;
    0x66 "f64.ge" [F64, F64] I32;
    0x67 "i32.clz" [I32] I32;
    0x68 "i32.ctz" [I32] I32;
    0x69 "i32.popcnt" [I32] I32;
    0x6a "i32.add" [I32, I32] I32;
    0x6b "i32.sub" [I32, I32] I32;
    0x6c "i32.mul" [I32, I32] I32;
    0x6d "i32.div_s" [I32, I32] I32;
    0x6e "i32.div_u" [I32, I32] I32;
    0x6f "i32.rem_s" [I32, I32] I32;
    0x70 "i32.rem_u" [I32, I32] I32;
    0x71 "i32.and" [I32, I32] I32;
    0x72 "i32.or" [I32, I32] I32;
    0x73 "i32.xor" [I32, I32] I32;
    0x74 "i32.shl" [I32, I32] I32;
    0x75 "i32.shr_s" [I32, I32] I32;
    0x76 "i32.shr_u" [I32, I32] I32;
    0x77 "i32.rotl" [I32, I32] I32;
    0x78 "i32.rotr" [I32, I32] I32;
    0x79 "i64.clz" [I64] I64;
    0x7a "i64.ctz" [I64] I64;
    0x7b "i64.popcnt" [I64] I64;
    0x7c "i64.add" [I64, I64] I64;
    0x7d "i64.sub" [I64, I64] I64;
    0x7e "i64.mul" [I64, I64] I64;
    0x7f "i64.div_s" [I64, I64] I64;
    0x80 "i64.div_u" [I64, I64] I64;
    0x81 "i64.rem_s" [I64, I64] I64;
    0x82 "i64.rem_u" [I64, I64] I64;
    0x83 "i64.and" [I64, I64] I64;
    0x84 "i64.or" [I64, I64] I64;
    0x85 "i64.xor" [I64, I64] I64;
    0x86 "i64.shl" [I64, I64] I64;
    0x87 "i64.shr_s" [I64, I64] I64;
    0x88 "i64.shr_u" [I64, I64] I64;
    0x89 "i64.rotl" [I64, I64] I64;
    0x8a "i64.rotr" [I64, I64] I64;
    0x8b "f32.abs" [F32] F32;
    0x8c "f32.neg" [F32] F32;
    0x8d "f32.ceil" [F32] F32;
    0x8e "f32.floor" [F32] F32;
    0x8f "f32.trunc" [F32] F32;
    0x90 "f32.nearest" [F32] F32;
    0x91 "f32.sqrt" [F32] F32;
    0x92 "f32.add" [F32, F32] F32;
    0x93 "f32.sub" [F32, F32] F32;
    0x94 "f32.mul" [F32, F32] F32;
    0x95 "f32.div" [F32, F32] F32;
    0x96 "f32.min" [F32, F32] F32;
    0x97 "f32.max" [F32, F32] F32;
    0x98 "f32.copysign" [F32, F32] F32;
    0x99 "f64.abs" [F64] F64;
    0x9a "f64.neg" [F64] F64;
    0x9b "f64.ceil" [F64] F64;
    0x9c "f64.floor" [F64] F64;
    0x9d "f64.trunc" [F64] F64;
    0x9e "f64.nearest" [F64] F64;
    0x9f "f64.sqrt" [F64] F64;
    0xa0 "f64.add" [F64, F64] F64;
    0xa1 "f64.sub" [F64, F64] F64;
    0xa2 "f64.mul" [F64, F64] F64;
    0xa3 "f64.div" [F64, F64] F64;
    0xa4 "f64.min" [F64, F64] F64;
    0xa5 "f64.max" [F64, F64] F64;
    0xa6 "f64.copysign" [F64, F64] F64;
    0xa7 "i32.wrap_i64" [I64] I32;
    0xa8 "i32.trunc_f32_s" [F32] I32;
    0xa9 "i32.trunc_f32_u" [F32] I32;
    0xaa "i32.trunc_f64_s" [F64] I32;
    0xab "i32.trunc_f64_u" [F64] I32;
    0xac "i64.extend_i32_s" [I32] I64;
    0xad "i64.extend_i32_u" [I32] I64;
    0xae "i64.trunc_f32_s" [F32] I64;
    0xaf "i64.trunc_f32_u" [F32] I64;
    0xb0 "i64.trunc_f64_s" [F64] I64;
    0xb1 "i64.trunc_f64_u" [F64] I64;
    0xb2 "f32.convert_i32_s" [I32] F32;
    0xb3 "f32.convert_i32_u" [I32] F32;
    0xb4 "f32.convert_i64_s" [I64] F32;
    0xb5 "f32.convert_i64_u" [I64] F32;
    0xb6 "f32.demote_f64" [F64] F32;
    0xb7 "f64.convert_i32_s" [I32] F64;
    0xb8 "f64.convert_i32_u" [I32] F64;
    0xb9 "f64.convert_i64_s" [I64] F64;
    0xba "f64.convert_i64_u" [I64] F64;
    0xbb "f64.promote_f32" [F32] F64;
    0xbc "i32.reinterpret_f32" [F32] I32;
    0xbd "i64.reinterpret_f64" [F64] I64;
    0xbe "f32.reinterpret_i32" [I32] F32;
    0xbf "f64.reinterpret_i64" [I64] F64;
}

pub const NUM_FIRST: u8 = 0x45;
pub const NUM_LAST: u8 = 0xbf;

pub fn num_op(code: u8) -> Option<&'static NumOp> {
    if (NUM_FIRST..=NUM_LAST).contains(&code) {
        Some(&NUM_OPS[(code - NUM_FIRST) as usize])
    } else {
        None
    }
}

pub fn num_op_by_name(name: &str) -> Option<&'static NumOp> {
    NUM_OPS.iter().find(|o| o.name == name)
}

/// A load or store: `(opcode, name, value type, access width in bytes)`.
pub struct MemOp {
    pub code: u8,
    pub name: &'static str,
    pub ty: ValType,
    pub bytes: u32,
}

pub static MEM_OPS: &[MemOp] = &[
    MemOp {
        code: 0x28,
        name: "i32.load",
        ty: I32,
        bytes: 4,
    },
    MemOp {
        code: 0x29,
        name: "i64.load",
        ty: I64,
        bytes: 8,
    },
    MemOp {
        code: 0x2a,
        name: "f32.load",
        ty: F32,
        bytes: 4,
    },
    MemOp {
        code: 0x2b,
        name: "f64.load",
        ty: F64,
        bytes: 8,
    },
    MemOp {
        code: 0x2c,
        name: "i32.load8_s",
        ty: I32,
        bytes: 1,
    },
    MemOp {
        code: 0x2d,
        name: "i32.load8_u",
        ty: I32,
        bytes: 1,
    },
    MemOp {
        code: 0x2e,
        name: "i32.load16_s",
        ty: I32,
        bytes: 2,
    },
    MemOp {
        code: 0x2f,
        name: "i32.load16_u",
        ty: I32,
        bytes: 2,
    },
    MemOp {
        code: 0x30,
        name: "i64.load8_s",
        ty: I64,
        bytes: 1,
    },
    MemOp {
        code: 0x31,
        name: "i64.load8_u",
        ty: I64,
        bytes: 1,
    },
    MemOp {
        code: 0x32,
        name: "i64.load16_s",
        ty: I64,
        bytes: 2,
    },
    MemOp {
        code: 0x33,
        name: "i64.load16_u",
        ty: I64,
        bytes: 2,
    },
    MemOp {
        code: 0x34,
        name: "i64.load32_s",
        ty: I64,
        bytes: 4,
    },
    MemOp {
        code: 0x35,
        name: "i64.load32_u",
        ty: I64,
        bytes: 4,
    },
    MemOp {
        code: 0x36,
        name: "i32.store",
        ty: I32,
        bytes: 4,
    },
    MemOp {
        code: 0x37,
        name: "i64.store",
        ty: I64,
        bytes: 8,
    },
    MemOp {
        code: 0x38,
        name: "f32.store",
        ty: F32,
        bytes: 4,
    },
    MemOp {
        code: 0x39,
        name: "f64.store",
        ty: F64,
        bytes: 8,
    },
    MemOp {
        code: 0x3a,
        name: "i32.store8",
        ty: I32,
        bytes: 1,
    },
    MemOp {
        code: 0x3b,
        name: "i32.store16",
        ty: I32,
        bytes: 2,
    },
    MemOp {
        code: 0x3c,
        name: "i64.store8",
        ty: I64,
        bytes: 1,
    },
    MemOp {
        code: 0x3d,
        name: "i64.store16",
        ty: I64,
        bytes: 2,
    },
    MemOp {
        code: 0x3e,
        name: "i64.store32",
        ty: I64,
        bytes: 4,
    },
];

pub fn mem_op(code: u8) -> Option<&'static MemOp> {
    if (0x28..=0x3e).contains(&code) {
        Some(&MEM_OPS[(code - 0x28) as usize])
    } else {
        None
    }
}

pub fn mem_op_by_name(name: &str) -> Option<&'static MemOp> {
    MEM_OPS.iter().find(|o| o.name == name)
}

pub fn is_store(code: u8) -> bool {
    (0x36..=0x3e).contains(&code)
}

/// The name an instruction has in the text format, for the debugger.
pub fn instr_name(i: &crate::module::Instr) -> &'static str {
    use crate::module::Instr::*;
    match i {
        Unreachable => "unreachable",
        Nop => "nop",
        Block { .. } => "block",
        Loop { .. } => "loop",
        If { .. } => "if",
        Else { .. } => "else",
        End => "end",
        Br(_) => "br",
        BrIf(_) => "br_if",
        BrTable(..) => "br_table",
        Return => "return",
        Call(_) => "call",
        CallIndirect(_) => "call_indirect",
        Drop => "drop",
        Select => "select",
        LocalGet(_) => "local.get",
        LocalSet(_) => "local.set",
        LocalTee(_) => "local.tee",
        GlobalGet(_) => "global.get",
        GlobalSet(_) => "global.set",
        Load(c, _) | Store(c, _) => mem_op(*c).map(|m| m.name).unwrap_or("?"),
        MemorySize => "memory.size",
        MemoryGrow => "memory.grow",
        I32Const(_) => "i32.const",
        I64Const(_) => "i64.const",
        F32Const(_) => "f32.const",
        F64Const(_) => "f64.const",
        Num(c) => num_op(*c).map(|n| n.name).unwrap_or("?"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_are_dense_and_in_opcode_order() {
        for (i, op) in NUM_OPS.iter().enumerate() {
            assert_eq!(op.code as usize, NUM_FIRST as usize + i, "{}", op.name);
        }
        assert_eq!(NUM_OPS.len(), (NUM_LAST - NUM_FIRST + 1) as usize);
        for (i, op) in MEM_OPS.iter().enumerate() {
            assert_eq!(op.code as usize, 0x28 + i, "{}", op.name);
        }
    }
}
