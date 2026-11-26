//! The WebAssembly store, instantiation and a steppable interpreter.
//!
//! Execution keeps every piece of machine state explicit (value stack, call
//! frames with their locals, label stack, program counter) so the debugger can
//! stop after any single instruction and show exactly what the machine holds.

use std::collections::HashMap;
use std::rc::Rc;

use crate::exec::{exec_num, load, store as store_mem};
use crate::module::*;

pub const PAGE: usize = 65536;
pub const MAX_PAGES: u32 = 65536;
/// Deep enough for real programs, shallow enough to stop runaway recursion quickly.
pub const MAX_FRAMES: usize = 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Trap(pub String);

impl Trap {
    pub fn new(m: &str) -> Self {
        Trap(m.to_string())
    }
}

/// Why instantiation failed: a link error ("unlinkable") or a trap while initialising.
#[derive(Debug, Clone, PartialEq)]
pub enum InstantiateError {
    Unlinkable(String),
    Trap(Trap),
}

pub type HostFn = Rc<dyn Fn(&mut Store, &[Value]) -> Result<Vec<Value>, Trap>>;

pub enum FuncInst {
    Wasm {
        ty: FuncType,
        module: Rc<ModuleInst>,
        code: Rc<Func>,
        index: u32,
    },
    Host {
        ty: FuncType,
        name: String,
        f: HostFn,
    },
}

impl FuncInst {
    pub fn ty(&self) -> &FuncType {
        match self {
            FuncInst::Wasm { ty, .. } | FuncInst::Host { ty, .. } => ty,
        }
    }
}

pub struct TableInst {
    pub elems: Vec<Option<u32>>,
    pub max: Option<u32>,
}

pub struct MemInst {
    pub data: Vec<u8>,
    pub max: Option<u32>,
}

impl MemInst {
    pub fn pages(&self) -> u32 {
        (self.data.len() / PAGE) as u32
    }
}

pub struct GlobalInst {
    pub ty: GlobalType,
    pub value: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternVal {
    Func(u32),
    Table(u32),
    Memory(u32),
    Global(u32),
}

impl ExternVal {
    pub fn kind(&self) -> ExternKind {
        match self {
            ExternVal::Func(_) => ExternKind::Func,
            ExternVal::Table(_) => ExternKind::Table,
            ExternVal::Memory(_) => ExternKind::Memory,
            ExternVal::Global(_) => ExternKind::Global,
        }
    }
}

/// A module after instantiation: its index spaces mapped to store addresses.
pub struct ModuleInst {
    pub types: Vec<FuncType>,
    pub funcs: Vec<u32>,
    pub tables: Vec<u32>,
    pub memories: Vec<u32>,
    pub globals: Vec<u32>,
    pub exports: HashMap<String, ExternVal>,
}

#[derive(Default)]
pub struct Store {
    pub funcs: Vec<FuncInst>,
    pub tables: Vec<TableInst>,
    pub memories: Vec<MemInst>,
    pub globals: Vec<GlobalInst>,
    /// Lines printed by host functions (the spectest `print*` imports, `pane.print`, `c.write`).
    pub output: Vec<String>,
    /// Bytes written after the last newline (`c.write`).
    pub pending: Vec<u8>,
    /// Set when a C program calls `exit` (see c_host.rs).
    pub exit_code: Option<i32>,
}

/// `pages` of zeroed memory, or None if it doesn't fit in this machine's address space.
fn zeroed_bytes(pages: u32) -> Option<Vec<u8>> {
    let bytes = usize::try_from(pages as u64 * PAGE as u64).ok()?;
    let mut v = Vec::new();
    v.try_reserve_exact(bytes).ok()?;
    v.resize(bytes, 0);
    Some(v)
}

/// Grows memory to `pages`; false (and nothing changes) when the host can't provide it.
fn grow_to(data: &mut Vec<u8>, pages: u32) -> bool {
    let Ok(bytes) = usize::try_from(pages as u64 * PAGE as u64) else {
        return false;
    };
    if data
        .try_reserve_exact(bytes.saturating_sub(data.len()))
        .is_err()
    {
        return false;
    }
    data.resize(bytes, 0);
    true
}

fn table_fits(have: &TableInst, want: Limits) -> bool {
    let len = have.elems.len() as u32;
    len >= want.min
        && match want.max {
            None => true,
            Some(wmax) => have.max.is_some_and(|m| m <= wmax),
        }
}

fn memory_fits(have: &MemInst, want: Limits) -> bool {
    have.pages() >= want.min
        && match want.max {
            None => true,
            Some(wmax) => have.max.is_some_and(|m| m <= wmax),
        }
}

impl Store {
    pub fn add_host_func(&mut self, name: &str, ty: FuncType, f: HostFn) -> u32 {
        self.funcs.push(FuncInst::Host {
            ty,
            name: name.to_string(),
            f,
        });
        self.funcs.len() as u32 - 1
    }

    pub fn add_table(&mut self, limits: Limits) -> u32 {
        self.tables.push(TableInst {
            elems: vec![None; limits.min as usize],
            max: limits.max,
        });
        self.tables.len() as u32 - 1
    }

    /// Allocates a memory. Fails (rather than aborting) when this machine can't
    /// hold it: 65,536 pages is 4 GiB, more than a 32-bit browser build can address.
    pub fn add_memory(&mut self, limits: Limits) -> Result<u32, Trap> {
        let data = zeroed_bytes(limits.min)
            .ok_or_else(|| Trap::new("out of memory: can't allocate the initial memory"))?;
        self.memories.push(MemInst {
            data,
            max: limits.max,
        });
        Ok(self.memories.len() as u32 - 1)
    }

    pub fn add_global(&mut self, ty: GlobalType, value: Value) -> u32 {
        self.globals.push(GlobalInst { ty, value });
        self.globals.len() as u32 - 1
    }

    /// Instantiates a validated module against `imports` (one per import, in order)
    /// and runs its start function.
    pub fn instantiate(
        &mut self,
        m: &Module,
        imports: &[ExternVal],
    ) -> Result<Rc<ModuleInst>, InstantiateError> {
        if imports.len() != m.imports.len() {
            return Err(InstantiateError::Unlinkable("unknown import".into()));
        }
        let mut inst = ModuleInst {
            types: m.types.clone(),
            funcs: Vec::new(),
            tables: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            exports: HashMap::new(),
        };
        let bad = |what: &str| {
            Err(InstantiateError::Unlinkable(format!(
                "incompatible import type: {what}"
            )))
        };
        for (imp, ext) in m.imports.iter().zip(imports) {
            match (&imp.desc, *ext) {
                (ImportDesc::Func(t), ExternVal::Func(a)) => {
                    if *self.funcs[a as usize].ty() != m.types[*t as usize] {
                        return bad("function signature");
                    }
                    inst.funcs.push(a);
                }
                (ImportDesc::Table(l), ExternVal::Table(a)) => {
                    if !table_fits(&self.tables[a as usize], *l) {
                        return bad("table limits");
                    }
                    inst.tables.push(a);
                }
                (ImportDesc::Memory(l), ExternVal::Memory(a)) => {
                    if !memory_fits(&self.memories[a as usize], *l) {
                        return bad("memory limits");
                    }
                    inst.memories.push(a);
                }
                (ImportDesc::Global(g), ExternVal::Global(a)) => {
                    if self.globals[a as usize].ty != *g {
                        return bad("global type");
                    }
                    inst.globals.push(a);
                }
                _ => return bad("kind"),
            }
        }

        // Functions refer back to their instance, so build it in two steps.
        let first_func = self.funcs.len() as u32;
        for i in 0..m.funcs.len() {
            inst.funcs.push(first_func + i as u32);
        }
        for t in &m.tables {
            inst.tables.push(self.add_table(*t));
        }
        for l in &m.memories {
            inst.memories
                .push(self.add_memory(*l).map_err(InstantiateError::Trap)?);
        }
        for g in &m.globals {
            let v = self.eval_const(&inst, &g.init);
            inst.globals.push(self.add_global(g.ty, v));
        }
        for e in &m.exports {
            let v = match e.kind {
                ExternKind::Func => ExternVal::Func(inst.funcs[e.index as usize]),
                ExternKind::Table => ExternVal::Table(inst.tables[e.index as usize]),
                ExternKind::Memory => ExternVal::Memory(inst.memories[e.index as usize]),
                ExternKind::Global => ExternVal::Global(inst.globals[e.index as usize]),
            };
            inst.exports.insert(e.name.clone(), v);
        }
        let inst = Rc::new(inst);
        for (i, f) in m.funcs.iter().enumerate() {
            self.funcs.push(FuncInst::Wasm {
                ty: m.types[f.type_idx as usize].clone(),
                module: inst.clone(),
                code: Rc::new(f.clone()),
                index: (m.imported(ExternKind::Func) + i) as u32,
            });
        }

        // WebAssembly 1.0: check that every segment fits before writing any of them.
        let mut elem_at = Vec::new();
        for e in &m.elems {
            let off = self.eval_const(&inst, &e.offset);
            let Value::I32(off) = off else { unreachable!() };
            let table = &self.tables[inst.tables[e.table as usize] as usize];
            if off as u32 as u64 + e.init.len() as u64 > table.elems.len() as u64 {
                return Err(InstantiateError::Unlinkable(
                    "elements segment does not fit".into(),
                ));
            }
            elem_at.push(off as u32 as usize);
        }
        let mut data_at = Vec::new();
        for d in &m.datas {
            let Value::I32(off) = self.eval_const(&inst, &d.offset) else {
                unreachable!()
            };
            let mem = &self.memories[inst.memories[d.memory as usize] as usize];
            if off as u32 as u64 + d.bytes.len() as u64 > mem.data.len() as u64 {
                return Err(InstantiateError::Unlinkable(
                    "data segment does not fit".into(),
                ));
            }
            data_at.push(off as u32 as usize);
        }
        for (e, at) in m.elems.iter().zip(elem_at) {
            let table = &mut self.tables[inst.tables[e.table as usize] as usize];
            for (i, f) in e.init.iter().enumerate() {
                table.elems[at + i] = Some(inst.funcs[*f as usize]);
            }
        }
        for (d, at) in m.datas.iter().zip(data_at) {
            let mem = &mut self.memories[inst.memories[d.memory as usize] as usize];
            mem.data[at..at + d.bytes.len()].copy_from_slice(&d.bytes);
        }
        if let Some(s) = m.start {
            self.invoke(inst.funcs[s as usize], &[])
                .map_err(InstantiateError::Trap)?;
        }
        Ok(inst)
    }

    fn eval_const(&self, inst: &ModuleInst, expr: &[Instr]) -> Value {
        match expr[0] {
            Instr::I32Const(v) => Value::I32(v),
            Instr::I64Const(v) => Value::I64(v),
            Instr::F32Const(v) => Value::F32(v),
            Instr::F64Const(v) => Value::F64(v),
            Instr::GlobalGet(x) => self.globals[inst.globals[x as usize] as usize].value,
            _ => unreachable!("validated constant expression"),
        }
    }

    /// Calls a function to completion.
    pub fn invoke(&mut self, func: u32, args: &[Value]) -> Result<Vec<Value>, Trap> {
        let mut t = Thread::default();
        t.start(self, func, args)?;
        while !t.done() {
            t.step(self)?;
        }
        Ok(t.results())
    }
}

/// A label on the label stack.
#[derive(Clone, Debug)]
pub struct Label {
    /// Values a branch to this label carries.
    pub arity: usize,
    /// Where a branch goes: the loop instruction itself (re-entered), or the block's `end`.
    pub target: usize,
    pub is_loop: bool,
    /// Value-stack height when the label was entered.
    pub height: usize,
    /// The pc of the block, loop or if that opened it (for the debugger).
    pub start: usize,
}

#[derive(Clone)]
pub struct Frame {
    /// Store address of the function.
    pub func: u32,
    /// The function's index in its module's function index space.
    pub code_index: u32,
    pub module: Rc<ModuleInst>,
    pub code: Rc<Func>,
    pub pc: usize,
    pub locals: Vec<Value>,
    pub arity: usize,
    /// Label-stack and value-stack heights when the frame was entered.
    pub label_base: usize,
    pub stack_base: usize,
}

/// One thread of execution: everything the debugger shows.
#[derive(Default)]
pub struct Thread {
    pub stack: Vec<Value>,
    pub frames: Vec<Frame>,
    pub labels: Vec<Label>,
    pub steps: u64,
    /// The memory access made by the last step: (effective address, bytes, was it a write).
    pub last_mem: Option<(u64, u32, bool)>,
    results: Vec<Value>,
}

impl Thread {
    pub fn done(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn results(&self) -> Vec<Value> {
        self.results.clone()
    }

    /// Pushes the arguments and enters `func` (host functions run immediately).
    pub fn start(&mut self, store: &mut Store, func: u32, args: &[Value]) -> Result<(), Trap> {
        let ty = store.funcs[func as usize].ty().clone();
        if args.len() != ty.params.len() || args.iter().zip(&ty.params).any(|(a, t)| a.ty() != *t) {
            return Err(Trap::new("argument type mismatch"));
        }
        self.stack.extend_from_slice(args);
        self.call(store, func)?;
        if self.frames.is_empty() {
            self.results = self.stack.drain(..).collect();
        }
        Ok(())
    }

    fn call(&mut self, store: &mut Store, func: u32) -> Result<(), Trap> {
        match &store.funcs[func as usize] {
            FuncInst::Host { ty, f, .. } => {
                let n = ty.params.len();
                let args: Vec<Value> = self.stack.split_off(self.stack.len() - n);
                let f = f.clone();
                let out = f(store, &args)?;
                self.stack.extend(out);
                Ok(())
            }
            FuncInst::Wasm {
                ty,
                module,
                code,
                index,
            } => {
                if self.frames.len() >= MAX_FRAMES {
                    return Err(Trap::new("call stack exhausted"));
                }
                let n = ty.params.len();
                let mut locals: Vec<Value> = self.stack.split_off(self.stack.len() - n);
                locals.extend(code.locals.iter().map(|t| Value::default_of(*t)));
                self.frames.push(Frame {
                    func,
                    code_index: *index,
                    module: module.clone(),
                    code: code.clone(),
                    pc: 0,
                    locals,
                    arity: ty.results.len(),
                    label_base: self.labels.len(),
                    stack_base: self.stack.len(),
                });
                Ok(())
            }
        }
    }

    /// Leaves the current function, keeping its results on the stack.
    fn return_from(&mut self) {
        let f = self.frames.pop().unwrap();
        let results = self.stack.split_off(self.stack.len() - f.arity);
        self.stack.truncate(f.stack_base);
        self.stack.extend(results);
        self.labels.truncate(f.label_base);
        if self.frames.is_empty() {
            self.results = self.stack.drain(..).collect();
        }
    }

    fn branch(&mut self, depth: u32) {
        // The function body is the outermost label: branching to it returns.
        let open = self.labels.len() - self.frames.last().unwrap().label_base;
        if depth as usize == open {
            self.return_from();
            return;
        }
        let idx = self.labels.len() - 1 - depth as usize;
        let label = self.labels[idx].clone();
        let vals = self.stack.split_off(self.stack.len() - label.arity);
        self.stack.truncate(label.height);
        self.stack.extend(vals);
        self.labels.truncate(idx);
        let frame = self.frames.last_mut().unwrap();
        // Loops are re-entered (their label is pushed again); blocks continue after their end.
        frame.pc = if label.is_loop {
            label.target
        } else {
            label.target + 1
        };
    }

    fn pop(&mut self) -> Value {
        self.stack.pop().expect("validated code never underflows")
    }
    fn pop_i32(&mut self) -> i32 {
        match self.pop() {
            Value::I32(v) => v,
            v => unreachable!("expected i32, got {v:?}"),
        }
    }

    /// Executes exactly one instruction of the innermost frame.
    pub fn step(&mut self, store: &mut Store) -> Result<(), Trap> {
        let frame = self.frames.last().unwrap();
        let pc = frame.pc;
        let code = frame.code.clone();
        let module = frame.module.clone();
        self.steps += 1;
        self.last_mem = None;
        let ins = &code.body[pc];
        self.frames.last_mut().unwrap().pc = pc + 1;
        use Instr::*;
        match ins {
            Unreachable => return Err(Trap::new("unreachable")),
            Nop => {}
            Block { ty, end } => self.labels.push(Label {
                arity: ty.results().len(),
                target: *end as usize,
                is_loop: false,
                height: self.stack.len(),
                start: pc,
            }),
            Loop { .. } => self.labels.push(Label {
                arity: 0,
                target: pc,
                is_loop: true,
                height: self.stack.len(),
                start: pc,
            }),
            If { ty, else_, end } => {
                let c = self.pop_i32();
                let label = Label {
                    arity: ty.results().len(),
                    target: *end as usize,
                    is_loop: false,
                    height: self.stack.len(),
                    start: pc,
                };
                if c != 0 {
                    self.labels.push(label);
                } else if else_ != end {
                    self.labels.push(label);
                    self.frames.last_mut().unwrap().pc = *else_ as usize + 1;
                } else {
                    self.frames.last_mut().unwrap().pc = *end as usize + 1;
                }
            }
            Else { end } => {
                // Reached the end of the then-branch: leave the if.
                self.labels.pop();
                self.frames.last_mut().unwrap().pc = *end as usize + 1;
            }
            End => {
                if self.labels.len() > self.frames.last().unwrap().label_base {
                    self.labels.pop();
                } else {
                    self.return_from();
                }
            }
            Br(l) => self.branch(*l),
            BrIf(l) => {
                if self.pop_i32() != 0 {
                    self.branch(*l);
                }
            }
            BrTable(ls, default) => {
                let i = self.pop_i32() as u32 as usize;
                let l = ls.get(i).copied().unwrap_or(*default);
                self.branch(l);
            }
            Return => self.return_from(),
            Call(x) => self.call(store, module.funcs[*x as usize])?,
            CallIndirect(t) => {
                let i = self.pop_i32() as u32 as usize;
                let table = &store.tables[module.tables[0] as usize];
                let Some(slot) = table.elems.get(i) else {
                    return Err(Trap::new("undefined element"));
                };
                let Some(f) = *slot else {
                    return Err(Trap::new(&format!("uninitialized element {i}")));
                };
                if *store.funcs[f as usize].ty() != module.types[*t as usize] {
                    return Err(Trap::new("indirect call type mismatch"));
                }
                self.call(store, f)?;
            }
            Drop => {
                self.pop();
            }
            Select => {
                let c = self.pop_i32();
                let b = self.pop();
                let a = self.pop();
                self.stack.push(if c != 0 { a } else { b });
            }
            LocalGet(x) => {
                let v = self.frames.last().unwrap().locals[*x as usize];
                self.stack.push(v);
            }
            LocalSet(x) => {
                let v = self.pop();
                self.frames.last_mut().unwrap().locals[*x as usize] = v;
            }
            LocalTee(x) => {
                let v = *self.stack.last().unwrap();
                self.frames.last_mut().unwrap().locals[*x as usize] = v;
            }
            GlobalGet(x) => self
                .stack
                .push(store.globals[module.globals[*x as usize] as usize].value),
            GlobalSet(x) => {
                let v = self.pop();
                store.globals[module.globals[*x as usize] as usize].value = v;
            }
            Instr::Load(op, arg) => {
                let addr = self.pop_i32();
                self.last_mem = Some((
                    addr as u32 as u64 + arg.offset as u64,
                    crate::opcodes::mem_op(*op).unwrap().bytes,
                    false,
                ));
                let mem = &store.memories[module.memories[0] as usize];
                let v = load(&mem.data, *op, addr, arg.offset)?;
                self.stack.push(v);
            }
            Instr::Store(op, arg) => {
                let v = self.pop();
                let addr = self.pop_i32();
                self.last_mem = Some((
                    addr as u32 as u64 + arg.offset as u64,
                    crate::opcodes::mem_op(*op).unwrap().bytes,
                    true,
                ));
                let mem = &mut store.memories[module.memories[0] as usize];
                store_mem(&mut mem.data, *op, addr, arg.offset, v)?;
            }
            MemorySize => {
                let mem = &store.memories[module.memories[0] as usize];
                self.stack.push(Value::I32(mem.pages() as i32));
            }
            MemoryGrow => {
                let delta = self.pop_i32() as u32;
                let mem = &mut store.memories[module.memories[0] as usize];
                let old = mem.pages();
                let limit = mem.max.unwrap_or(MAX_PAGES).min(MAX_PAGES);
                let r = match old.checked_add(delta) {
                    // A grow the host can't satisfy fails like one past the limit.
                    Some(new) if new <= limit && grow_to(&mut mem.data, new) => old as i32,
                    _ => -1,
                };
                self.stack.push(Value::I32(r));
            }
            I32Const(v) => self.stack.push(Value::I32(*v)),
            I64Const(v) => self.stack.push(Value::I64(*v)),
            F32Const(v) => self.stack.push(Value::F32(*v)),
            F64Const(v) => self.stack.push(Value::F64(*v)),
            Num(op) => exec_num(&mut self.stack, *op)?,
        }
        Ok(())
    }
}
