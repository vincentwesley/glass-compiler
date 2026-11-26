//! The in-memory form of a WebAssembly 1.0 module, shared by the text parser,
//! the binary decoder, the validator and the interpreter.
//!
//! Instructions are kept flat (one `Vec<Instr>` per function, ending in `End`),
//! the way the binary format stores them. Each structured instruction carries
//! the index of its matching `else`/`end`, filled in by [`link_blocks`], so the
//! interpreter can branch without searching and the debugger can show nesting.

use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ValType {
    I32,
    I64,
    F32,
    F64,
}

impl ValType {
    pub fn name(self) -> &'static str {
        match self {
            ValType::I32 => "i32",
            ValType::I64 => "i64",
            ValType::F32 => "f32",
            ValType::F64 => "f64",
        }
    }
}

impl fmt::Display for ValType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct FuncType {
    pub params: Vec<ValType>,
    pub results: Vec<ValType>,
}

impl fmt::Display for FuncType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let list = |v: &[ValType]| v.iter().map(|t| t.name()).collect::<Vec<_>>().join(" ");
        write!(f, "[{}] -> [{}]", list(&self.params), list(&self.results))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub min: u32,
    pub max: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GlobalType {
    pub ty: ValType,
    pub mutable: bool,
}

/// A value. Floats are kept as raw bits so NaN payloads survive untouched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Value {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
}

impl Value {
    pub fn ty(self) -> ValType {
        match self {
            Value::I32(_) => ValType::I32,
            Value::I64(_) => ValType::I64,
            Value::F32(_) => ValType::F32,
            Value::F64(_) => ValType::F64,
        }
    }

    pub fn default_of(ty: ValType) -> Value {
        match ty {
            ValType::I32 => Value::I32(0),
            ValType::I64 => Value::I64(0),
            ValType::F32 => Value::F32(0),
            ValType::F64 => Value::F64(0),
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Value::I32(v) => write!(f, "i32:{v}"),
            Value::I64(v) => write!(f, "i64:{v}"),
            Value::F32(b) => write!(f, "f32:{}", crate::float::fmt_f32(b)),
            Value::F64(b) => write!(f, "f64:{}", crate::float::fmt_f64(b)),
        }
    }
}

/// WebAssembly 1.0 block types: no value or a single result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockType {
    Empty,
    Value(ValType),
}

impl BlockType {
    pub fn results(self) -> &'static [ValType] {
        match self {
            BlockType::Empty => &[],
            BlockType::Value(ValType::I32) => &[ValType::I32],
            BlockType::Value(ValType::I64) => &[ValType::I64],
            BlockType::Value(ValType::F32) => &[ValType::F32],
            BlockType::Value(ValType::F64) => &[ValType::F64],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemArg {
    /// log2 of the alignment hint
    pub align: u32,
    pub offset: u32,
}

/// One instruction. Numeric instructions without immediates are `Num(opcode)`,
/// loads and stores carry their opcode byte too (see [`crate::opcodes`]).
#[derive(Clone, Debug, PartialEq)]
pub enum Instr {
    Unreachable,
    Nop,
    /// `end` is the index of the matching `End`.
    Block { ty: BlockType, end: u32 },
    Loop { ty: BlockType, end: u32 },
    /// `else_` is the index of the matching `Else`, or of the `End` when there is none.
    If { ty: BlockType, else_: u32, end: u32 },
    Else { end: u32 },
    End,
    Br(u32),
    BrIf(u32),
    BrTable(Box<[u32]>, u32),
    Return,
    Call(u32),
    CallIndirect(u32),
    Drop,
    Select,
    LocalGet(u32),
    LocalSet(u32),
    LocalTee(u32),
    GlobalGet(u32),
    GlobalSet(u32),
    Load(u8, MemArg),
    Store(u8, MemArg),
    MemorySize,
    MemoryGrow,
    I32Const(i32),
    I64Const(i64),
    F32Const(u32),
    F64Const(u64),
    Num(u8),
}

#[derive(Clone, Debug, PartialEq)]
pub enum ImportDesc {
    Func(u32),
    Table(Limits),
    Memory(Limits),
    Global(GlobalType),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Import {
    pub module: String,
    pub name: String,
    pub desc: ImportDesc,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternKind {
    Func,
    Table,
    Memory,
    Global,
}

impl ExternKind {
    pub fn name(self) -> &'static str {
        match self {
            ExternKind::Func => "func",
            ExternKind::Table => "table",
            ExternKind::Memory => "memory",
            ExternKind::Global => "global",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Export {
    pub name: String,
    pub kind: ExternKind,
    pub index: u32,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Func {
    pub type_idx: u32,
    /// Declared locals (not including parameters).
    pub locals: Vec<ValType>,
    pub body: Vec<Instr>,
    /// Debug info, when the module came from text: the function's `$name`,
    /// names of params and locals, and each instruction's source offset.
    pub name: Option<String>,
    pub local_names: Vec<Option<String>>,
    pub offsets: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Global {
    pub ty: GlobalType,
    pub init: Vec<Instr>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Elem {
    pub table: u32,
    pub offset: Vec<Instr>,
    pub init: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Data {
    pub memory: u32,
    pub offset: Vec<Instr>,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Module {
    pub types: Vec<FuncType>,
    pub imports: Vec<Import>,
    pub funcs: Vec<Func>,
    pub tables: Vec<Limits>,
    pub memories: Vec<Limits>,
    pub globals: Vec<Global>,
    pub exports: Vec<Export>,
    pub start: Option<u32>,
    pub elems: Vec<Elem>,
    pub datas: Vec<Data>,
}

impl Module {
    pub fn imported(&self, kind: ExternKind) -> usize {
        self.imports
            .iter()
            .filter(|i| {
                matches!(
                    (&i.desc, kind),
                    (ImportDesc::Func(_), ExternKind::Func)
                        | (ImportDesc::Table(_), ExternKind::Table)
                        | (ImportDesc::Memory(_), ExternKind::Memory)
                        | (ImportDesc::Global(_), ExternKind::Global)
                )
            })
            .count()
    }

    /// Type of function `idx` in the function index space (imports first).
    pub fn func_type(&self, idx: u32) -> Option<&FuncType> {
        let mut i = idx as usize;
        for imp in &self.imports {
            if let ImportDesc::Func(t) = imp.desc {
                if i == 0 {
                    return self.types.get(t as usize);
                }
                i -= 1;
            }
        }
        self.funcs.get(i).and_then(|f| self.types.get(f.type_idx as usize))
    }

    pub fn global_type(&self, idx: u32) -> Option<GlobalType> {
        let mut i = idx as usize;
        for imp in &self.imports {
            if let ImportDesc::Global(g) = imp.desc {
                if i == 0 {
                    return Some(g);
                }
                i -= 1;
            }
        }
        self.globals.get(i).map(|g| g.ty)
    }

    pub fn table_count(&self) -> usize {
        self.imported(ExternKind::Table) + self.tables.len()
    }

    pub fn memory_count(&self) -> usize {
        self.imported(ExternKind::Memory) + self.memories.len()
    }

    pub fn func_count(&self) -> usize {
        self.imported(ExternKind::Func) + self.funcs.len()
    }

    pub fn global_count(&self) -> usize {
        self.imported(ExternKind::Global) + self.globals.len()
    }
}

/// Fills in the `end`/`else_` indices of structured instructions. Returns an
/// error message when blocks don't nest (an `else` without an `if`, a missing
/// `end`, or stray instructions after the final `end`).
pub fn link_blocks(body: &mut [Instr]) -> Result<(), &'static str> {
    let mut open: Vec<usize> = Vec::new();
    // The function body itself is an implicit block closed by its last End.
    let mut closed_function = false;
    for i in 0..body.len() {
        if closed_function {
            return Err("instructions after the function's end");
        }
        match body[i] {
            Instr::Block { .. } | Instr::Loop { .. } | Instr::If { .. } => open.push(i),
            Instr::Else { .. } => {
                let Some(&start) = open.last() else { return Err("else without if") };
                match &mut body[start] {
                    Instr::If { else_, .. } if *else_ == u32::MAX => *else_ = i as u32,
                    _ => return Err("else without if"),
                }
            }
            Instr::End => match open.pop() {
                None => closed_function = true,
                Some(start) => {
                    let end = i as u32;
                    match &mut body[start] {
                        Instr::Block { end: e, .. } | Instr::Loop { end: e, .. } => *e = end,
                        Instr::If { else_, end: e, .. } => {
                            *e = end;
                            if *else_ == u32::MAX {
                                *else_ = end;
                            } else {
                                let at = *else_ as usize;
                                body[at] = Instr::Else { end };
                            }
                        }
                        _ => unreachable!(),
                    }
                }
            },
            _ => {}
        }
    }
    if !closed_function {
        return Err("missing end");
    }
    Ok(())
}

/// Same nesting check for a constant expression (globals, offsets): it must end with End.
pub fn check_const_end(expr: &[Instr]) -> Result<(), &'static str> {
    match expr.last() {
        Some(Instr::End) => Ok(()),
        _ => Err("missing end"),
    }
}

/// Placeholder index used before [`link_blocks`] runs.
pub const UNLINKED: u32 = u32::MAX;
