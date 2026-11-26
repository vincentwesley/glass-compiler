//! Decodes the WebAssembly 1.0 binary format into a [`Module`]. Errors use the
//! spec testsuite's wording ("unexpected end", "integer too large", …).

use crate::module::*;
use crate::opcodes::{mem_op, num_op};

#[derive(Debug, Clone, PartialEq)]
pub struct DecodeError {
    pub message: String,
    pub offset: usize,
}

type Result<T> = std::result::Result<T, DecodeError>;

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    /// End of the current section; reads past it are "unexpected end of section or function".
    end: usize,
}

impl<'a> Reader<'a> {
    fn err<T>(&self, message: &str) -> Result<T> {
        Err(DecodeError {
            message: message.to_string(),
            offset: self.pos,
        })
    }

    fn eof_message(&self) -> &'static str {
        if self.end < self.bytes.len() {
            "unexpected end of section or function"
        } else {
            "unexpected end"
        }
    }

    fn byte(&mut self) -> Result<u8> {
        if self.pos >= self.end {
            return self.err(self.eof_message());
        }
        let b = self.bytes[self.pos];
        self.pos += 1;
        Ok(b)
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.end - self.pos {
            return self.err(self.eof_message());
        }
        let s = &self.bytes[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    fn uleb(&mut self, bits: u32) -> Result<u64> {
        let mut result: u64 = 0;
        let mut shift = 0;
        let max_bytes = bits.div_ceil(7);
        for i in 0..max_bytes {
            let b = self.byte()?;
            let low = (b & 0x7f) as u64;
            if i == max_bytes - 1 {
                if b & 0x80 != 0 {
                    return self.err("integer representation too long");
                }
                let used = bits - shift;
                if used < 7 && low >> used != 0 {
                    return self.err("integer too large");
                }
            }
            result |= low << shift;
            if b & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
        }
        unreachable!()
    }

    fn sleb(&mut self, bits: u32) -> Result<i64> {
        let mut result: i64 = 0;
        let mut shift = 0;
        let max_bytes = bits.div_ceil(7);
        for i in 0..max_bytes {
            let b = self.byte()?;
            let low = (b & 0x7f) as i64;
            if i == max_bytes - 1 {
                if b & 0x80 != 0 {
                    return self.err("integer representation too long");
                }
                // The unused high bits of the last byte must all equal the sign bit.
                let used = bits - shift; // bits that matter in this byte, 1..=7
                if used < 7 {
                    let sign_and_unused = (b & 0x7f) >> (used - 1);
                    let all = (1u8 << (8 - used)) - 1;
                    if sign_and_unused != 0 && sign_and_unused != all {
                        return self.err("integer too large");
                    }
                }
            }
            result |= low << shift;
            shift += 7;
            if b & 0x80 == 0 {
                if shift < 64 && b & 0x40 != 0 {
                    result |= -1i64 << shift;
                }
                return Ok(result);
            }
        }
        unreachable!()
    }

    fn u32(&mut self) -> Result<u32> {
        self.uleb(32).map(|v| v as u32)
    }

    fn name(&mut self) -> Result<String> {
        let len = self.u32()? as usize;
        if len > self.end - self.pos {
            return self.err(if self.end < self.bytes.len() {
                "unexpected end of section or function"
            } else {
                "length out of bounds"
            });
        }
        let bytes = self.take(len)?;
        match std::str::from_utf8(bytes) {
            Ok(s) => Ok(s.to_string()),
            Err(_) => self.err("invalid UTF-8 encoding"),
        }
    }

    fn valtype(&mut self) -> Result<ValType> {
        match self.byte()? {
            0x7f => Ok(ValType::I32),
            0x7e => Ok(ValType::I64),
            0x7d => Ok(ValType::F32),
            0x7c => Ok(ValType::F64),
            _ => self.err("invalid value type"),
        }
    }

    fn limits(&mut self) -> Result<Limits> {
        match self.byte()? {
            0x00 => Ok(Limits {
                min: self.u32()?,
                max: None,
            }),
            0x01 => {
                let min = self.u32()?;
                Ok(Limits {
                    min,
                    max: Some(self.u32()?),
                })
            }
            _ => self.err("integer too large"),
        }
    }

    fn table_type(&mut self) -> Result<Limits> {
        if self.byte()? != 0x70 {
            return self.err("malformed element type");
        }
        self.limits()
    }

    fn global_type(&mut self) -> Result<GlobalType> {
        let ty = self.valtype()?;
        let mutable = match self.byte()? {
            0 => false,
            1 => true,
            _ => return self.err("malformed mutability"),
        };
        Ok(GlobalType { ty, mutable })
    }

    fn vec<T>(&mut self, mut item: impl FnMut(&mut Self) -> Result<T>) -> Result<Vec<T>> {
        let n = self.u32()? as usize;
        // Each item takes at least one byte; refuse absurd counts before allocating.
        if n > self.end - self.pos {
            return self.err(self.eof_message());
        }
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            v.push(item(self)?);
        }
        Ok(v)
    }

    fn block_type(&mut self) -> Result<BlockType> {
        match self.byte()? {
            0x40 => Ok(BlockType::Empty),
            0x7f => Ok(BlockType::Value(ValType::I32)),
            0x7e => Ok(BlockType::Value(ValType::I64)),
            0x7d => Ok(BlockType::Value(ValType::F32)),
            0x7c => Ok(BlockType::Value(ValType::F64)),
            _ => self.err("invalid value type"),
        }
    }

    fn memarg(&mut self) -> Result<MemArg> {
        let align = self.u32()?;
        let offset = self.u32()?;
        Ok(MemArg { align, offset })
    }

    /// Reads instructions until the `end` that closes the expression (depth 0).
    /// Returns the instructions (the closing End included) and their byte offsets.
    fn expr(&mut self) -> Result<(Vec<Instr>, Vec<u32>)> {
        let mut out = Vec::new();
        let mut offsets = Vec::new();
        let mut depth = 0usize;
        loop {
            let at = self.pos as u32;
            let op = self.byte()?;
            let ins = match op {
                0x00 => Instr::Unreachable,
                0x01 => Instr::Nop,
                0x02 => {
                    depth += 1;
                    Instr::Block {
                        ty: self.block_type()?,
                        end: UNLINKED,
                    }
                }
                0x03 => {
                    depth += 1;
                    Instr::Loop {
                        ty: self.block_type()?,
                        end: UNLINKED,
                    }
                }
                0x04 => {
                    depth += 1;
                    Instr::If {
                        ty: self.block_type()?,
                        else_: UNLINKED,
                        end: UNLINKED,
                    }
                }
                0x05 => Instr::Else { end: UNLINKED },
                0x0b => Instr::End,
                0x0c => Instr::Br(self.u32()?),
                0x0d => Instr::BrIf(self.u32()?),
                0x0e => {
                    let labels = self.vec(|r| r.u32())?;
                    Instr::BrTable(labels.into_boxed_slice(), self.u32()?)
                }
                0x0f => Instr::Return,
                0x10 => Instr::Call(self.u32()?),
                0x11 => {
                    let t = self.u32()?;
                    if self.byte()? != 0 {
                        return self.err("zero flag expected");
                    }
                    Instr::CallIndirect(t)
                }
                0x1a => Instr::Drop,
                0x1b => Instr::Select,
                0x20 => Instr::LocalGet(self.u32()?),
                0x21 => Instr::LocalSet(self.u32()?),
                0x22 => Instr::LocalTee(self.u32()?),
                0x23 => Instr::GlobalGet(self.u32()?),
                0x24 => Instr::GlobalSet(self.u32()?),
                0x28..=0x35 => Instr::Load(op, self.memarg()?),
                0x36..=0x3e => Instr::Store(op, self.memarg()?),
                0x3f | 0x40 => {
                    if self.byte()? != 0 {
                        return self.err("zero flag expected");
                    }
                    if op == 0x3f {
                        Instr::MemorySize
                    } else {
                        Instr::MemoryGrow
                    }
                }
                0x41 => Instr::I32Const(self.sleb(32)? as i32),
                0x42 => Instr::I64Const(self.sleb(64)?),
                0x43 => Instr::F32Const(u32::from_le_bytes(self.take(4)?.try_into().unwrap())),
                0x44 => Instr::F64Const(u64::from_le_bytes(self.take(8)?.try_into().unwrap())),
                0x45..=0xbf => {
                    debug_assert!(num_op(op).is_some() && mem_op(op).is_none());
                    Instr::Num(op)
                }
                _ => {
                    return Err(DecodeError {
                        message: "illegal opcode".into(),
                        offset: at as usize,
                    })
                }
            };
            let is_end = ins == Instr::End;
            out.push(ins);
            offsets.push(at);
            if is_end {
                if depth == 0 {
                    return Ok((out, offsets));
                }
                depth -= 1;
            }
        }
    }
}

/// Decodes a binary module.
pub fn decode(bytes: &[u8]) -> Result<Module> {
    let mut r = Reader {
        bytes,
        pos: 0,
        end: bytes.len(),
    };
    if r.take(4).map_err(|_| DecodeError {
        message: "unexpected end".into(),
        offset: 0,
    })? != b"\0asm"
    {
        return Err(DecodeError {
            message: "magic header not detected".into(),
            offset: 0,
        });
    }
    let version = r.take(4).map_err(|_| DecodeError {
        message: "unexpected end".into(),
        offset: 4,
    })?;
    if version != [1, 0, 0, 0] {
        return Err(DecodeError {
            message: "unknown binary version".into(),
            offset: 4,
        });
    }

    let mut m = Module::default();
    let mut func_types: Vec<u32> = Vec::new();
    let mut code_count: Option<usize> = None;
    let mut last_id = 0u8;

    while r.pos < bytes.len() {
        let id = r.byte()?;
        let size = r.u32()? as usize;
        if size > bytes.len() - r.pos {
            return r.err("length out of bounds");
        }
        let section_end = r.pos + size;
        r.end = section_end;
        if id != 0 {
            if id > 11 {
                return r.err("invalid section id");
            }
            if id <= last_id {
                return r.err("unexpected content after last section");
            }
            last_id = id;
        }
        match id {
            0 => {
                let name = r.name()?;
                m.customs.push((name, bytes[r.pos..section_end].to_vec()));
                r.pos = section_end;
            }
            1 => {
                m.types = r.vec(|r| {
                    if r.byte()? != 0x60 {
                        return r.err("integer representation too long");
                    }
                    let params = r.vec(|r| r.valtype())?;
                    let results = r.vec(|r| r.valtype())?;
                    Ok(FuncType { params, results })
                })?
            }
            2 => {
                m.imports = r.vec(|r| {
                    let module = r.name()?;
                    let name = r.name()?;
                    let desc = match r.byte()? {
                        0 => ImportDesc::Func(r.u32()?),
                        1 => ImportDesc::Table(r.table_type()?),
                        2 => ImportDesc::Memory(r.limits()?),
                        3 => ImportDesc::Global(r.global_type()?),
                        _ => return r.err("malformed import kind"),
                    };
                    Ok(Import { module, name, desc })
                })?
            }
            3 => func_types = r.vec(|r| r.u32())?,
            4 => m.tables = r.vec(|r| r.table_type())?,
            5 => m.memories = r.vec(|r| r.limits())?,
            6 => {
                m.globals = r.vec(|r| {
                    let ty = r.global_type()?;
                    let (init, _) = r.expr()?;
                    Ok(Global { ty, init })
                })?
            }
            7 => {
                m.exports = r.vec(|r| {
                    let name = r.name()?;
                    let kind = match r.byte()? {
                        0 => ExternKind::Func,
                        1 => ExternKind::Table,
                        2 => ExternKind::Memory,
                        3 => ExternKind::Global,
                        _ => return r.err("malformed export kind"),
                    };
                    Ok(Export {
                        name,
                        kind,
                        index: r.u32()?,
                    })
                })?
            }
            8 => m.start = Some(r.u32()?),
            9 => {
                m.elems = r.vec(|r| {
                    let table = r.u32()?;
                    let (offset, _) = r.expr()?;
                    let init = r.vec(|r| r.u32())?;
                    Ok(Elem {
                        table,
                        offset,
                        init,
                    })
                })?
            }
            10 => {
                let bodies = r.vec(|r| {
                    let size = r.u32()? as usize;
                    if size > r.end - r.pos {
                        return r.err("unexpected end of section or function");
                    }
                    let body_end = r.pos + size;
                    let outer_end = r.end;
                    r.end = body_end;
                    let groups = r.vec(|r| Ok((r.u32()?, r.valtype()?)))?;
                    let total: u64 = groups.iter().map(|g| g.0 as u64).sum();
                    if total > u32::MAX as u64 {
                        return r.err("too many locals");
                    }
                    let mut locals = Vec::with_capacity(total.min(1 << 16) as usize);
                    for (n, t) in groups {
                        locals.extend(std::iter::repeat_n(t, n as usize));
                    }
                    let (mut body, _byte_offsets) = r.expr()?;
                    // Positions refer to source text; a binary has none unless glass.map adds them.
                    let offsets = vec![u32::MAX; body.len()];
                    if r.pos != body_end {
                        return r.err("section size mismatch");
                    }
                    r.end = outer_end;
                    link_blocks(&mut body).map_err(|e| DecodeError {
                        message: e.into(),
                        offset: r.pos,
                    })?;
                    Ok(Func {
                        type_idx: 0,
                        locals,
                        body,
                        offsets,
                        ..Default::default()
                    })
                })?;
                code_count = Some(bodies.len());
                m.funcs = bodies;
            }
            11 => {
                m.datas = r.vec(|r| {
                    let memory = r.u32()?;
                    let (offset, _) = r.expr()?;
                    let len = r.u32()? as usize;
                    let bytes = r.take(len)?.to_vec();
                    Ok(Data {
                        memory,
                        offset,
                        bytes,
                    })
                })?
            }
            _ => unreachable!(),
        }
        if r.pos != section_end {
            return r.err("section size mismatch");
        }
        r.end = bytes.len();
    }

    if func_types.len() != code_count.unwrap_or(0) {
        return Err(DecodeError {
            message: "function and code section have inconsistent lengths".into(),
            offset: bytes.len(),
        });
    }
    for (f, t) in m.funcs.iter_mut().zip(func_types) {
        f.type_idx = t;
    }
    apply_debug_sections(&mut m);
    Ok(m)
}

/// Applies the optional debug custom sections. They are hints: a malformed one is
/// ignored, never an error, as the spec requires of custom sections.
fn apply_debug_sections(m: &mut Module) {
    let sections = m.customs.clone();
    for (name, data) in &sections {
        let mut r = Reader {
            bytes: data,
            pos: 0,
            end: data.len(),
        };
        let _ = match name.as_str() {
            "name" => apply_names(m, &mut r),
            "glass.map" => apply_map(m, &mut r),
            _ => Ok(()),
        };
    }
}

fn defined_func(m: &mut Module, index: u32) -> Option<&mut Func> {
    let imported = m.imported(ExternKind::Func) as u32;
    index
        .checked_sub(imported)
        .and_then(move |i| m.funcs.get_mut(i as usize))
}

/// The standard `name` section: function names (1) and local names (2).
fn apply_names(m: &mut Module, r: &mut Reader) -> Result<()> {
    while r.pos < r.end {
        let id = r.byte()?;
        let size = r.u32()? as usize;
        let end = r.pos + size;
        match id {
            1 => {
                for (idx, name) in r.vec(|r| Ok((r.u32()?, r.name()?)))? {
                    if let Some(f) = defined_func(m, idx) {
                        f.name = Some(name);
                    }
                }
            }
            2 => {
                for (idx, locals) in
                    r.vec(|r| Ok((r.u32()?, r.vec(|r| Ok((r.u32()?, r.name()?)))?)))?
                {
                    let params = m.func_type(idx).map(|t| t.params.len()).unwrap_or(0);
                    if let Some(f) = defined_func(m, idx) {
                        let n = params + f.locals.len();
                        f.local_names = vec![None; n];
                        for (li, name) in locals {
                            if let Some(slot) = f.local_names.get_mut(li as usize) {
                                *slot = Some(name);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        r.pos = end;
    }
    Ok(())
}

/// `glass.map`: for some functions, the source byte offset of each instruction
/// (stored plus one; zero means "no source position").
fn apply_map(m: &mut Module, r: &mut Reader) -> Result<()> {
    for (idx, offsets) in r.vec(|r| Ok((r.u32()?, r.vec(|r| r.u32())?)))? {
        if let Some(f) = defined_func(m, idx) {
            if offsets.len() == f.body.len() {
                f.offsets = offsets.into_iter().map(|o| o.wrapping_sub(1)).collect();
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn module(sections: &[u8]) -> Vec<u8> {
        let mut v = b"\0asm\x01\0\0\0".to_vec();
        v.extend_from_slice(sections);
        v
    }

    #[test]
    fn decodes_a_function_that_adds() {
        // (func (param i32 i32) (result i32) local.get 0 local.get 1 i32.add) exported as "add"
        let bytes = module(&[
            1, 7, 1, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, // type
            3, 2, 1, 0, // func
            7, 7, 1, 3, b'a', b'd', b'd', 0, 0, // export
            10, 9, 1, 7, 0, 0x20, 0, 0x20, 1, 0x6a, 0x0b, // code
        ]);
        let m = decode(&bytes).unwrap();
        assert_eq!(m.types[0].params, vec![ValType::I32, ValType::I32]);
        assert_eq!(
            m.funcs[0].body,
            vec![
                Instr::LocalGet(0),
                Instr::LocalGet(1),
                Instr::Num(0x6a),
                Instr::End
            ]
        );
        assert_eq!(m.exports[0].name, "add");
    }

    #[test]
    fn reports_spec_messages() {
        assert_eq!(
            decode(b"\0asx\x01\0\0\0").unwrap_err().message,
            "magic header not detected"
        );
        assert_eq!(
            decode(b"\0asm\x02\0\0\0").unwrap_err().message,
            "unknown binary version"
        );
        assert_eq!(
            decode(b"\0asm\x01\0").unwrap_err().message,
            "unexpected end"
        );
        // memory with min encoded in 6 LEB bytes
        assert_eq!(
            decode(&module(&[5, 8, 1, 0, 0x82, 0x80, 0x80, 0x80, 0x80, 0x00]))
                .unwrap_err()
                .message,
            "integer representation too long"
        );
        // memory min with high bits set in the 5th byte
        assert_eq!(
            decode(&module(&[5, 7, 1, 0, 0x82, 0x80, 0x80, 0x80, 0x10]))
                .unwrap_err()
                .message,
            "integer too large"
        );
        // a function section with no code section
        assert_eq!(
            decode(&module(&[1, 4, 1, 0x60, 0, 0, 3, 2, 1, 0]))
                .unwrap_err()
                .message,
            "function and code section have inconsistent lengths"
        );
    }

    #[test]
    fn signed_leb_rules() {
        let mut r = Reader {
            bytes: &[0x7f],
            pos: 0,
            end: 1,
        };
        assert_eq!(r.sleb(32).unwrap(), -1);
        let mut r = Reader {
            bytes: &[0xff, 0xff, 0xff, 0xff, 0x7f],
            pos: 0,
            end: 5,
        };
        assert_eq!(r.sleb(32).unwrap(), -1);
        let mut r = Reader {
            bytes: &[0xff, 0xff, 0xff, 0xff, 0x4f],
            pos: 0,
            end: 5,
        };
        assert_eq!(r.sleb(32).unwrap_err().message, "integer too large");
        let mut r = Reader {
            bytes: &[0x80, 0x80, 0x80, 0x80, 0x08],
            pos: 0,
            end: 5,
        };
        assert_eq!(r.sleb(32).unwrap_err().message, "integer too large");
    }
}
