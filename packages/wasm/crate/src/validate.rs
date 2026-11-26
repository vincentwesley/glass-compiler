//! Module validation for WebAssembly 1.0, following the algorithm in the spec's
//! appendix: an operand stack of (possibly unknown) types and a stack of
//! control frames. Messages use the testsuite's wording ("type mismatch", …).

use crate::module::*;
use crate::opcodes::{mem_op, num_op};

#[derive(Debug, Clone, PartialEq)]
pub struct ValidationError {
    pub message: String,
    /// Function index (in the function index space) and instruction index, when inside code.
    pub func: Option<u32>,
    pub instr: Option<usize>,
}

type Result<T> = std::result::Result<T, ValidationError>;

fn err<T>(message: &str) -> Result<T> {
    Err(ValidationError {
        message: message.into(),
        func: None,
        instr: None,
    })
}

const MAX_PAGES: u32 = 65536;

pub fn validate(m: &Module) -> Result<()> {
    if m.types.iter().any(|t| t.results.len() > 1) {
        return err("invalid result arity");
    }
    // Function, table, memory and global types in index order.
    let mut funcs: Vec<u32> = Vec::new();
    let mut tables: Vec<Limits> = Vec::new();
    let mut memories: Vec<Limits> = Vec::new();
    let mut globals: Vec<GlobalType> = Vec::new();
    let mut imported_globals = 0usize;
    for imp in &m.imports {
        match imp.desc {
            ImportDesc::Func(t) => {
                if t as usize >= m.types.len() {
                    return err("unknown type");
                }
                funcs.push(t);
            }
            ImportDesc::Table(l) => tables.push(l),
            ImportDesc::Memory(l) => memories.push(l),
            ImportDesc::Global(g) => {
                globals.push(g);
                imported_globals += 1;
            }
        }
    }
    for f in &m.funcs {
        if f.type_idx as usize >= m.types.len() {
            return err("unknown type");
        }
        funcs.push(f.type_idx);
    }
    tables.extend(m.tables.iter().copied());
    memories.extend(m.memories.iter().copied());
    if tables.len() > 1 {
        return err("multiple tables");
    }
    if memories.len() > 1 {
        return err("multiple memories");
    }
    for t in &tables {
        if let Some(max) = t.max {
            if t.min > max {
                return err("size minimum must not be greater than maximum");
            }
        }
    }
    for mem in &memories {
        if mem.min > MAX_PAGES || mem.max.is_some_and(|x| x > MAX_PAGES) {
            return err("memory size must be at most 65536 pages (4GiB)");
        }
        if let Some(max) = mem.max {
            if mem.min > max {
                return err("size minimum must not be greater than maximum");
            }
        }
    }

    // Globals: initialisers may only read imported globals.
    for g in &m.globals {
        const_expr(&g.init, g.ty.ty, &globals[..imported_globals])?;
        globals.push(g.ty);
    }

    let module_ctx = ModuleCtx {
        m,
        funcs: &funcs,
        tables: tables.len(),
        memories: memories.len(),
        globals: &globals,
    };
    let imported_funcs = funcs.len() - m.funcs.len();
    for (i, f) in m.funcs.iter().enumerate() {
        let func_index = (imported_funcs + i) as u32;
        validate_func(&module_ctx, f).map_err(|mut e| {
            e.func = Some(func_index);
            e
        })?;
    }

    for e in &m.elems {
        if e.table as usize >= tables.len() {
            return err("unknown table");
        }
        const_expr(&e.offset, ValType::I32, &globals[..imported_globals])?;
        for &f in &e.init {
            if f as usize >= funcs.len() {
                return err("unknown function");
            }
        }
    }
    for d in &m.datas {
        if d.memory as usize >= memories.len() {
            return err("unknown memory");
        }
        const_expr(&d.offset, ValType::I32, &globals[..imported_globals])?;
    }
    if let Some(s) = m.start {
        let Some(&t) = funcs.get(s as usize) else {
            return err("unknown function");
        };
        let ft = &m.types[t as usize];
        if !ft.params.is_empty() || !ft.results.is_empty() {
            return err("start function");
        }
    }
    let mut names = std::collections::HashSet::new();
    for e in &m.exports {
        if !names.insert(e.name.as_str()) {
            return err("duplicate export name");
        }
        let ok = match e.kind {
            ExternKind::Func => (e.index as usize) < funcs.len(),
            ExternKind::Table => (e.index as usize) < tables.len(),
            ExternKind::Memory => (e.index as usize) < memories.len(),
            ExternKind::Global => (e.index as usize) < globals.len(),
        };
        if !ok {
            return err(&format!("unknown {}", e.kind.name()));
        }
    }
    Ok(())
}

fn const_expr(expr: &[Instr], ty: ValType, globals: &[GlobalType]) -> Result<()> {
    let got = match expr {
        [Instr::I32Const(_), Instr::End] => ValType::I32,
        [Instr::I64Const(_), Instr::End] => ValType::I64,
        [Instr::F32Const(_), Instr::End] => ValType::F32,
        [Instr::F64Const(_), Instr::End] => ValType::F64,
        [Instr::GlobalGet(x), Instr::End] => match globals.get(*x as usize) {
            Some(g) if g.mutable => return err("constant expression required"),
            Some(g) => g.ty,
            None => return err("unknown global"),
        },
        [Instr::End] => return err("type mismatch"),
        _ => {
            // Anything else is either not constant, or a constant sequence of the wrong length.
            let all_const = expr.iter().all(|i| {
                matches!(
                    i,
                    Instr::I32Const(_)
                        | Instr::I64Const(_)
                        | Instr::F32Const(_)
                        | Instr::F64Const(_)
                        | Instr::GlobalGet(_)
                        | Instr::End
                )
            });
            return err(if all_const {
                "type mismatch"
            } else {
                "constant expression required"
            });
        }
    };
    if got != ty {
        return err("type mismatch");
    }
    Ok(())
}

struct ModuleCtx<'a> {
    m: &'a Module,
    funcs: &'a [u32],
    tables: usize,
    memories: usize,
    globals: &'a [GlobalType],
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Block,
    Loop,
    If,
    Else,
}

struct Ctrl {
    kind: Kind,
    results: &'static [ValType],
    height: usize,
    unreachable: bool,
}

struct FuncCheck<'a> {
    ops: Vec<Option<ValType>>,
    ctrls: Vec<Ctrl>,
    locals: Vec<ValType>,
    results: &'a [ValType],
}

impl FuncCheck<'_> {
    fn push(&mut self, t: Option<ValType>) {
        self.ops.push(t);
    }

    fn pop(&mut self) -> Result<Option<ValType>> {
        let c = self.ctrls.last().unwrap();
        if self.ops.len() == c.height {
            if c.unreachable {
                return Ok(None);
            }
            return err("type mismatch");
        }
        Ok(self.ops.pop().unwrap())
    }

    fn pop_expect(&mut self, want: ValType) -> Result<()> {
        match self.pop()? {
            Some(t) if t != want => err("type mismatch"),
            _ => Ok(()),
        }
    }

    fn pop_all(&mut self, want: &[ValType]) -> Result<()> {
        for &t in want.iter().rev() {
            self.pop_expect(t)?;
        }
        Ok(())
    }

    fn label_types(&self, depth: u32) -> Result<&'static [ValType]> {
        let n = self.ctrls.len();
        if depth as usize >= n {
            return err("unknown label");
        }
        let c = &self.ctrls[n - 1 - depth as usize];
        Ok(if c.kind == Kind::Loop { &[] } else { c.results })
    }

    fn set_unreachable(&mut self) {
        let c = self.ctrls.last_mut().unwrap();
        self.ops.truncate(c.height);
        c.unreachable = true;
    }

    /// Checks the stack holds exactly the frame's results, then pops the frame.
    fn end_frame(&mut self) -> Result<Ctrl> {
        let results = self.ctrls.last().unwrap().results;
        self.pop_all(results)?;
        if self.ops.len() != self.ctrls.last().unwrap().height {
            return err("type mismatch");
        }
        Ok(self.ctrls.pop().unwrap())
    }
}

fn validate_func(mc: &ModuleCtx, f: &Func) -> Result<()> {
    let ft = &mc.m.types[f.type_idx as usize];
    let mut locals = ft.params.clone();
    locals.extend_from_slice(&f.locals);
    let func_results: &'static [ValType] = leak_results(&ft.results)?;
    let mut c = FuncCheck {
        ops: Vec::new(),
        ctrls: Vec::new(),
        locals,
        results: &ft.results,
    };
    // The function body is the outermost block.
    c.ctrls.push(Ctrl {
        kind: Kind::Block,
        results: func_results,
        height: 0,
        unreachable: false,
    });

    for (pc, ins) in f.body.iter().enumerate() {
        step(mc, &mut c, ins).map_err(|mut e| {
            e.instr = Some(pc);
            e
        })?;
        if c.ctrls.is_empty() && pc + 1 != f.body.len() {
            return Err(ValidationError {
                message: "instructions after the function's end".into(),
                func: None,
                instr: Some(pc + 1),
            });
        }
    }
    if !c.ctrls.is_empty() {
        return err("missing end");
    }
    Ok(())
}

/// Result lists are at most one value in WebAssembly 1.0 blocks; functions may
/// declare more, which is invalid ("invalid result arity").
fn leak_results(r: &[ValType]) -> Result<&'static [ValType]> {
    match r {
        [] => Ok(&[]),
        [t] => Ok(BlockType::Value(*t).results()),
        _ => err("invalid result arity"),
    }
}

fn step(mc: &ModuleCtx, c: &mut FuncCheck, ins: &Instr) -> Result<()> {
    use Instr::*;
    match ins {
        Unreachable => c.set_unreachable(),
        Nop => {}
        Block { ty, .. } | Loop { ty, .. } => {
            let kind = if matches!(ins, Block { .. }) {
                Kind::Block
            } else {
                Kind::Loop
            };
            c.ctrls.push(Ctrl {
                kind,
                results: ty.results(),
                height: c.ops.len(),
                unreachable: false,
            });
        }
        If { ty, .. } => {
            c.pop_expect(ValType::I32)?;
            c.ctrls.push(Ctrl {
                kind: Kind::If,
                results: ty.results(),
                height: c.ops.len(),
                unreachable: false,
            });
        }
        Else { .. } => {
            if c.ctrls.last().map(|x| x.kind) != Some(Kind::If) {
                return err("else without if");
            }
            let frame = c.end_frame()?;
            c.ctrls.push(Ctrl {
                kind: Kind::Else,
                results: frame.results,
                height: c.ops.len(),
                unreachable: false,
            });
        }
        End => {
            let frame = c.end_frame()?;
            if frame.kind == Kind::If && !frame.results.is_empty() {
                // An `if` with a result needs an `else` to produce it.
                return err("type mismatch");
            }
            for &t in frame.results {
                c.push(Some(t));
            }
        }
        Br(l) => {
            let t = c.label_types(*l)?;
            c.pop_all(t)?;
            c.set_unreachable();
        }
        BrIf(l) => {
            c.pop_expect(ValType::I32)?;
            let t = c.label_types(*l)?;
            c.pop_all(t)?;
            for &x in t {
                c.push(Some(x));
            }
        }
        BrTable(labels, default) => {
            c.pop_expect(ValType::I32)?;
            let t = c.label_types(*default)?;
            for &l in labels.iter() {
                if c.label_types(l)? != t {
                    return err("type mismatch");
                }
            }
            c.pop_all(t)?;
            c.set_unreachable();
        }
        Return => {
            let r = c.results.to_vec();
            c.pop_all(&r)?;
            c.set_unreachable();
        }
        Call(x) => {
            let Some(&t) = mc.funcs.get(*x as usize) else {
                return err("unknown function");
            };
            let ft = &mc.m.types[t as usize];
            c.pop_all(&ft.params)?;
            for &r in &ft.results {
                c.push(Some(r));
            }
        }
        CallIndirect(t) => {
            if mc.tables == 0 {
                return err("unknown table");
            }
            let Some(ft) = mc.m.types.get(*t as usize) else {
                return err("unknown type");
            };
            c.pop_expect(ValType::I32)?;
            c.pop_all(&ft.params)?;
            for &r in &ft.results {
                c.push(Some(r));
            }
        }
        Drop => {
            c.pop()?;
        }
        Select => {
            c.pop_expect(ValType::I32)?;
            let a = c.pop()?;
            let b = c.pop()?;
            match (a, b) {
                (Some(x), Some(y)) if x != y => return err("type mismatch"),
                (Some(x), _) | (None, Some(x)) => c.push(Some(x)),
                (None, None) => c.push(None),
            }
        }
        LocalGet(x) | LocalSet(x) | LocalTee(x) => {
            let Some(&t) = c.locals.get(*x as usize) else {
                return err("unknown local");
            };
            match ins {
                LocalGet(_) => c.push(Some(t)),
                LocalSet(_) => c.pop_expect(t)?,
                _ => {
                    c.pop_expect(t)?;
                    c.push(Some(t));
                }
            }
        }
        GlobalGet(x) => {
            let Some(g) = mc.globals.get(*x as usize) else {
                return err("unknown global");
            };
            c.push(Some(g.ty));
        }
        GlobalSet(x) => {
            let Some(g) = mc.globals.get(*x as usize) else {
                return err("unknown global");
            };
            if !g.mutable {
                return err("global is immutable");
            }
            c.pop_expect(g.ty)?;
        }
        Load(op, arg) | Store(op, arg) => {
            if mc.memories == 0 {
                return err("unknown memory");
            }
            let mo = mem_op(*op).unwrap();
            if arg.align >= 32 || (1u64 << arg.align) > mo.bytes as u64 {
                return err("alignment must not be larger than natural");
            }
            if matches!(ins, Load(..)) {
                c.pop_expect(ValType::I32)?;
                c.push(Some(mo.ty));
            } else {
                c.pop_expect(mo.ty)?;
                c.pop_expect(ValType::I32)?;
            }
        }
        MemorySize => {
            if mc.memories == 0 {
                return err("unknown memory");
            }
            c.push(Some(ValType::I32));
        }
        MemoryGrow => {
            if mc.memories == 0 {
                return err("unknown memory");
            }
            c.pop_expect(ValType::I32)?;
            c.push(Some(ValType::I32));
        }
        I32Const(_) => c.push(Some(ValType::I32)),
        I64Const(_) => c.push(Some(ValType::I64)),
        F32Const(_) => c.push(Some(ValType::F32)),
        F64Const(_) => c.push(Some(ValType::F64)),
        Num(op) => {
            let n = num_op(*op).unwrap();
            c.pop_all(n.params)?;
            c.push(Some(n.result));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::parse_module_text;

    fn check(src: &str) -> std::result::Result<(), String> {
        let m = parse_module_text(src).map_err(|e| format!("parse: {}", e.message))?;
        validate(&m).map_err(|e| e.message)
    }

    #[test]
    fn accepts_valid_code() {
        check("(module (func (param i32) (result i32) (block (result i32) (br 0 (local.get 0)))))")
            .unwrap();
        check("(module (func (result i32) unreachable i32.add))").unwrap();
        check("(module (func (result i32) (br_table 0 0 (i32.const 1) (i32.const 0))))").unwrap();
        check("(module (memory 1) (func (result i64) (i64.load8_u (i32.const 0))))").unwrap();
    }

    #[test]
    fn rejects_invalid_code() {
        assert_eq!(
            check("(module (func (result i32) (i64.const 1)))"),
            Err("type mismatch".into())
        );
        assert_eq!(
            check(
                "(module (func (result i32) (if (result i32) (i32.const 1) (then (i32.const 1)))))"
            ),
            Err("type mismatch".into())
        );
        assert_eq!(check("(module (func br 1))"), Err("unknown label".into()));
        assert_eq!(
            check("(module (func (i32.load (i32.const 0)) drop))"),
            Err("unknown memory".into())
        );
        assert_eq!(
            check("(module (global i32 (i32.const 0)) (func (global.set 0 (i32.const 1))))"),
            Err("global is immutable".into())
        );
        assert_eq!(
            check("(module (memory 1) (func (drop (i32.load8_s align=2 (i32.const 0)))))"),
            Err("alignment must not be larger than natural".into())
        );
        assert_eq!(
            check("(module (memory 65537))"),
            Err("memory size must be at most 65536 pages (4GiB)".into())
        );
        assert_eq!(
            check("(module (func (export \"a\")) (func (export \"a\")))"),
            Err("duplicate export name".into())
        );
        assert_eq!(
            check("(module (global i32 (i32.add (i32.const 1) (i32.const 2))))"),
            Err("constant expression required".into())
        );
    }
}
