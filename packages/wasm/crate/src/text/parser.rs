//! Text format (WAT) to [`Module`]: names resolved, abbreviations expanded,
//! folded instructions flattened. Anything the text grammar rejects is a
//! `ParseError` ("malformed"); type errors are left to the validator ("invalid").

use std::collections::HashMap;

use super::lexer::{parse_sexps, Sexp, Tok};
use crate::float;
use crate::module::*;
use crate::opcodes::{mem_op_by_name, num_op_by_name};

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub message: String,
    pub offset: usize,
}

type Result<T> = std::result::Result<T, ParseError>;

fn fail<T>(message: impl Into<String>, at: &Sexp) -> Result<T> {
    Err(ParseError { message: message.into(), offset: at.offset() })
}

/// Parses a whole text: either one `(module …)` or bare module fields.
pub fn parse_module_text(src: &str) -> Result<Module> {
    let sexps = parse_sexps(src).map_err(|e| ParseError { message: e.message, offset: e.offset })?;
    if sexps.len() == 1 && sexps[0].is_form("module") {
        let items = sexps[0].list().unwrap();
        let mut rest = &items[1..];
        if rest.first().and_then(|s| s.id()).is_some() {
            rest = &rest[1..];
        }
        return parse_module_fields(rest);
    }
    parse_module_fields(&sexps)
}

// ---------------------------------------------------------------- numbers

fn digits_value(text: &str) -> Option<u64> {
    let (radix, digits) = match text.strip_prefix("0x") {
        Some(h) => (16, h),
        None => (10, text),
    };
    let ok = if radix == 16 { float::check_underscores(digits) } else { float::check_underscores_dec(digits) };
    if digits.is_empty() || !ok {
        return None;
    }
    let mut v: u64 = 0;
    for c in digits.chars().filter(|&c| c != '_') {
        let d = c.to_digit(radix)? as u64;
        v = v.checked_mul(radix as u64)?.checked_add(d)?;
    }
    Some(v)
}

/// An unsigned literal (no sign allowed).
pub fn parse_nat(text: &str) -> Option<u64> {
    if text.starts_with(['+', '-']) {
        return None;
    }
    digits_value(text)
}

/// An integer literal for an N-bit `const`: signed or unsigned interpretation accepted.
pub fn parse_int(text: &str, bits: u32) -> std::result::Result<u64, &'static str> {
    let (neg, body) = match text.as_bytes().first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    if body.is_empty() || !body.as_bytes()[0].is_ascii_digit() {
        return Err("unknown operator");
    }
    let Some(v) = digits_value(body) else {
        // A well-formed literal that is simply too big is "out of range"; anything else is malformed.
        let (radix, digits) = match body.strip_prefix("0x") {
            Some(h) => (16, h),
            None => (10, body),
        };
        let underscores_ok = if radix == 16 { float::check_underscores(digits) } else { float::check_underscores_dec(digits) };
        let well_formed = !digits.is_empty() && underscores_ok && digits.chars().all(|c| c == '_' || c.is_digit(radix));
        return Err(if well_formed { "constant out of range" } else { "unknown operator" });
    };
    let mask = if bits == 64 { u64::MAX } else { (1u64 << bits) - 1 };
    if neg {
        let min_mag = 1u64 << (bits - 1);
        if v > min_mag {
            return Err("constant out of range");
        }
        Ok(v.wrapping_neg() & mask)
    } else {
        if v > mask {
            return Err("constant out of range");
        }
        Ok(v)
    }
}

fn parse_float_lit(s: &Sexp, fmt: float::Format) -> Result<u64> {
    let Some(text) = s.atom() else { return fail("unexpected token", s) };
    let first = text.trim_start_matches(['+', '-']);
    let ok_start = first.starts_with(|c: char| c.is_ascii_digit()) || first.starts_with("inf") || first.starts_with("nan");
    if !ok_start {
        return fail("unexpected token", s);
    }
    match float::parse(text, fmt) {
        Ok(b) => Ok(b),
        Err(float::FloatError::OutOfRange) => fail("constant out of range", s),
        Err(float::FloatError::Malformed) => fail("unknown operator", s),
    }
}

// ---------------------------------------------------------------- names

#[derive(Default)]
struct Space {
    names: HashMap<String, u32>,
    count: u32,
}

impl Space {
    fn add(&mut self, name: Option<&str>, at: &Sexp, what: &str) -> Result<u32> {
        let idx = self.count;
        if let Some(n) = name {
            if self.names.insert(n.to_string(), idx).is_some() {
                return fail(format!("duplicate {what}"), at);
            }
        }
        self.count += 1;
        Ok(idx)
    }

    fn resolve(&self, s: &Sexp, what: &str) -> Result<u32> {
        match s {
            Sexp::Tok(Tok::Id(n), _) => match self.names.get(n) {
                Some(&i) => Ok(i),
                None => fail(format!("unknown {what}"), s),
            },
            Sexp::Tok(Tok::Atom(a), _) => match parse_nat(a) {
                Some(v) if v <= u32::MAX as u64 => Ok(v as u32),
                Some(_) => fail("constant out of range", s),
                None => fail("unexpected token", s),
            },
            _ => fail("unexpected token", s),
        }
    }
}

fn is_index(s: &Sexp) -> bool {
    match s {
        Sexp::Tok(Tok::Id(_), _) => true,
        Sexp::Tok(Tok::Atom(a), _) => a.starts_with(|c: char| c.is_ascii_digit()),
        _ => false,
    }
}

fn valtype(s: &Sexp) -> Result<ValType> {
    match s.atom() {
        Some("i32") => Ok(ValType::I32),
        Some("i64") => Ok(ValType::I64),
        Some("f32") => Ok(ValType::F32),
        Some("f64") => Ok(ValType::F64),
        _ => fail("unexpected token", s),
    }
}

fn string_of(s: &Sexp) -> Result<String> {
    match s.string() {
        Some(b) => match std::str::from_utf8(b) {
            Ok(t) => Ok(t.to_string()),
            Err(_) => fail("malformed UTF-8 encoding", s),
        },
        None => fail("unexpected token", s),
    }
}

// ---------------------------------------------------------------- module

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Func,
    Table,
    Memory,
    Global,
}

struct Ctx {
    types: Vec<FuncType>,
    type_names: Space,
    funcs: Space,
    tables: Space,
    memories: Space,
    globals: Space,
}

/// A function's parsed `typeuse`: optional `(type x)`, then params (with names) and results.
struct TypeUse {
    index: Option<u32>,
    params: Vec<(Option<String>, ValType)>,
    results: Vec<ValType>,
    /// whether any (param)/(result) appeared inline
    inline: bool,
}

/// Reads `(type x)? (param …)* (result …)*` from the front of `items`; returns how many items it used.
fn parse_typeuse(items: &[Sexp], ctx: &Ctx, allow_names: bool) -> Result<(TypeUse, usize)> {
    let mut i = 0;
    let mut tu = TypeUse { index: None, params: Vec::new(), results: Vec::new(), inline: false };
    if let Some(s) = items.first().filter(|s| s.is_form("type")) {
        let l = s.list().unwrap();
        if l.len() != 2 {
            return fail("unexpected token", s);
        }
        tu.index = Some(ctx.type_names.resolve(&l[1], "type")?);
        i = 1;
    }
    while let Some(s) = items.get(i).filter(|s| s.is_form("param")) {
        let l = &s.list().unwrap()[1..];
        if let Some(name) = l.first().and_then(|x| x.id()) {
            if !allow_names {
                return fail("unexpected token", s);
            }
            if l.len() != 2 {
                return fail("unexpected token", s);
            }
            tu.params.push((Some(name.to_string()), valtype(&l[1])?));
        } else {
            for t in l {
                tu.params.push((None, valtype(t)?));
            }
        }
        tu.inline = true;
        i += 1;
    }
    while let Some(s) = items.get(i).filter(|s| s.is_form("result")) {
        for t in &s.list().unwrap()[1..] {
            tu.results.push(valtype(t)?);
        }
        tu.inline = true;
        i += 1;
    }
    Ok((tu, i))
}

/// Turns a typeuse into a type index, appending an implicit type when needed.
fn resolve_typeuse(tu: &TypeUse, types: &mut Vec<FuncType>, at: &Sexp) -> Result<u32> {
    let inline = FuncType { params: tu.params.iter().map(|p| p.1).collect(), results: tu.results.clone() };
    match tu.index {
        Some(idx) => {
            if tu.inline {
                match types.get(idx as usize) {
                    Some(t) if *t == inline => {}
                    Some(_) => return fail("inline function type", at),
                    None => {} // an unknown index is the validator's "unknown type"
                }
            }
            Ok(idx)
        }
        None => {
            if let Some(pos) = types.iter().position(|t| *t == inline) {
                Ok(pos as u32)
            } else {
                types.push(inline);
                Ok(types.len() as u32 - 1)
            }
        }
    }
}

/// Splits off leading `(export "…")` forms and an optional `(import "m" "n")`.
fn inline_exports_imports<'a>(items: &'a [Sexp]) -> Result<(Vec<String>, Option<(String, String)>, &'a [Sexp])> {
    let mut i = 0;
    let mut exports = Vec::new();
    let mut import = None;
    loop {
        match items.get(i) {
            Some(s) if s.is_form("export") => {
                let l = s.list().unwrap();
                if l.len() != 2 {
                    return fail("unexpected token", s);
                }
                exports.push(string_of(&l[1])?);
                i += 1;
            }
            Some(s) if s.is_form("import") && import.is_none() => {
                let l = s.list().unwrap();
                if l.len() != 3 {
                    return fail("unexpected token", s);
                }
                import = Some((string_of(&l[1])?, string_of(&l[2])?));
                i += 1;
            }
            _ => break,
        }
    }
    Ok((exports, import, &items[i..]))
}

fn limits(items: &[Sexp], at: &Sexp) -> Result<Limits> {
    let nat = |s: &Sexp| -> Result<u32> {
        match s.atom().and_then(parse_nat) {
            Some(v) if v <= u32::MAX as u64 => Ok(v as u32),
            Some(_) => fail("constant out of range", s),
            None => fail("unexpected token", s),
        }
    };
    match items {
        [min] => Ok(Limits { min: nat(min)?, max: None }),
        [min, max] => Ok(Limits { min: nat(min)?, max: Some(nat(max)?) }),
        _ => fail("unexpected token", at),
    }
}

fn global_type(s: &Sexp) -> Result<GlobalType> {
    if s.is_form("mut") {
        let l = s.list().unwrap();
        if l.len() != 2 {
            return fail("unexpected token", s);
        }
        Ok(GlobalType { ty: valtype(&l[1])?, mutable: true })
    } else {
        Ok(GlobalType { ty: valtype(s)?, mutable: false })
    }
}

fn field_id(items: &[Sexp]) -> (Option<&str>, &[Sexp]) {
    match items.first().and_then(|s| s.id()) {
        Some(id) => (Some(id), &items[1..]),
        None => (None, items),
    }
}

pub fn parse_module_fields(fields: &[Sexp]) -> Result<Module> {
    let mut ctx = Ctx {
        types: Vec::new(),
        type_names: Space::default(),
        funcs: Space::default(),
        tables: Space::default(),
        memories: Space::default(),
        globals: Space::default(),
    };

    // Pass 1: explicit types, and every index space's names, in order.
    let mut defined = [false; 4]; // a non-import definition of each kind seen
    for f in fields {
        let Some(head) = f.head() else { return fail("unexpected token", f) };
        let items = &f.list().unwrap()[1..];
        let (id, rest) = field_id(items);
        let mut note = |kind: Kind, is_import: bool, ctx: &mut Ctx| -> Result<()> {
            let k = kind as usize;
            if is_import && defined.iter().any(|&d| d) {
                return fail(format!("import after {}", ["function", "table", "memory", "global"][defined.iter().position(|&d| d).unwrap()]), f);
            }
            if !is_import {
                defined[k] = true;
            }
            let (space, what) = match kind {
                Kind::Func => (&mut ctx.funcs, "function"),
                Kind::Table => (&mut ctx.tables, "table"),
                Kind::Memory => (&mut ctx.memories, "memory"),
                Kind::Global => (&mut ctx.globals, "global"),
            };
            space.add(id, f, what).map(|_| ())
        };
        match head {
            "type" => {
                let [def] = rest else { return fail("unexpected token", f) };
                if !def.is_form("func") {
                    return fail("unexpected token", def);
                }
                let (tu, used) = parse_typeuse(&def.list().unwrap()[1..], &ctx, true)?;
                if used != def.list().unwrap().len() - 1 || tu.index.is_some() {
                    return fail("unexpected token", def);
                }
                ctx.type_names.add(id, f, "type")?;
                ctx.types.push(FuncType { params: tu.params.iter().map(|p| p.1).collect(), results: tu.results });
            }
            "import" => {
                let [_, _, desc] = items else { return fail("unexpected token", f) };
                let kind = match desc.head() {
                    Some("func") => Kind::Func,
                    Some("table") => Kind::Table,
                    Some("memory") => Kind::Memory,
                    Some("global") => Kind::Global,
                    _ => return fail("unexpected token", desc),
                };
                let (did, _) = field_id(&desc.list().unwrap()[1..]);
                let k = kind as usize;
                if defined.iter().any(|&d| d) {
                    return fail(format!("import after {}", ["function", "table", "memory", "global"][defined.iter().position(|&d| d).unwrap()]), f);
                }
                let _ = k;
                let (space, what) = match kind {
                    Kind::Func => (&mut ctx.funcs, "function"),
                    Kind::Table => (&mut ctx.tables, "table"),
                    Kind::Memory => (&mut ctx.memories, "memory"),
                    Kind::Global => (&mut ctx.globals, "global"),
                };
                space.add(did, desc, what)?;
            }
            "func" | "table" | "memory" | "global" => {
                let kind = match head {
                    "func" => Kind::Func,
                    "table" => Kind::Table,
                    "memory" => Kind::Memory,
                    _ => Kind::Global,
                };
                let (_, import, _) = inline_exports_imports(rest)?;
                note(kind, import.is_some(), &mut ctx)?;
            }
            "export" | "start" | "elem" | "data" => {}
            _ => return fail("unexpected token", f),
        }
    }

    // Pass 2: build the module in text order.
    let mut m = Module::default();
    let mut func_imports_done = 0u32;
    let _ = &mut func_imports_done;
    for f in fields {
        let head = f.head().unwrap();
        let items = &f.list().unwrap()[1..];
        let (id, rest) = field_id(items);
        match head {
            "type" => {}
            "import" => {
                let module = string_of(&items[0])?;
                let name = string_of(&items[1])?;
                let desc_s = &items[2];
                let (_, d) = field_id(&desc_s.list().unwrap()[1..]);
                let desc = import_desc(desc_s.head().unwrap(), d, desc_s, &mut ctx)?;
                m.imports.push(Import { module, name, desc });
            }
            "func" => {
                let (exports, import, rest) = inline_exports_imports(rest)?;
                let index = ctx.funcs.names.get(id.unwrap_or("")).copied().filter(|_| id.is_some());
                let my_index = index.unwrap_or_else(|| m.func_count() as u32);
                for e in exports {
                    m.exports.push(Export { name: e, kind: ExternKind::Func, index: my_index });
                }
                if let Some((module, name)) = import {
                    let (tu, used) = parse_typeuse(rest, &ctx, true)?;
                    if used != rest.len() {
                        return fail("unexpected token", &rest[used]);
                    }
                    let t = resolve_typeuse(&tu, &mut ctx.types, f)?;
                    m.imports.push(Import { module, name, desc: ImportDesc::Func(t) });
                } else {
                    let func = parse_func(rest, id, f, &mut ctx)?;
                    m.funcs.push(func);
                }
            }
            "table" => {
                let (exports, import, rest) = inline_exports_imports(rest)?;
                let my_index = m.table_count() as u32;
                for e in exports {
                    m.exports.push(Export { name: e, kind: ExternKind::Table, index: my_index });
                }
                if let Some((module, name)) = import {
                    let lim = table_type(rest, f)?;
                    m.imports.push(Import { module, name, desc: ImportDesc::Table(lim) });
                } else if rest.len() == 2 && rest[0].atom() == Some("funcref") && rest[1].is_form("elem") {
                    let elems = &rest[1].list().unwrap()[1..];
                    let mut init = Vec::new();
                    for e in elems {
                        init.push(ctx.funcs.resolve(e, "function")?);
                    }
                    let n = init.len() as u32;
                    m.tables.push(Limits { min: n, max: Some(n) });
                    m.elems.push(Elem { table: my_index, offset: vec![Instr::I32Const(0), Instr::End], init });
                } else {
                    m.tables.push(table_type(rest, f)?);
                }
            }
            "memory" => {
                let (exports, import, rest) = inline_exports_imports(rest)?;
                let my_index = m.memory_count() as u32;
                for e in exports {
                    m.exports.push(Export { name: e, kind: ExternKind::Memory, index: my_index });
                }
                if let Some((module, name)) = import {
                    m.imports.push(Import { module, name, desc: ImportDesc::Memory(limits(rest, f)?) });
                } else if rest.len() == 1 && rest[0].is_form("data") {
                    let mut bytes = Vec::new();
                    for s in &rest[0].list().unwrap()[1..] {
                        match s.string() {
                            Some(b) => bytes.extend_from_slice(b),
                            None => return fail("unexpected token", s),
                        }
                    }
                    let pages = (bytes.len() as u64).div_ceil(65536) as u32;
                    m.memories.push(Limits { min: pages, max: Some(pages) });
                    m.datas.push(Data { memory: my_index, offset: vec![Instr::I32Const(0), Instr::End], bytes });
                } else {
                    m.memories.push(limits(rest, f)?);
                }
            }
            "global" => {
                let (exports, import, rest) = inline_exports_imports(rest)?;
                let my_index = m.global_count() as u32;
                for e in exports {
                    m.exports.push(Export { name: e, kind: ExternKind::Global, index: my_index });
                }
                let Some(ty_s) = rest.first() else { return fail("unexpected token", f) };
                let ty = global_type(ty_s)?;
                if let Some((module, name)) = import {
                    if rest.len() != 1 {
                        return fail("unexpected token", &rest[1]);
                    }
                    m.imports.push(Import { module, name, desc: ImportDesc::Global(ty) });
                } else {
                    let init = const_expr(&rest[1..], &mut ctx, f)?;
                    m.globals.push(Global { ty, init });
                }
            }
            "export" => {
                let [name, desc] = items else { return fail("unexpected token", f) };
                let name = string_of(name)?;
                let Some(dl) = desc.list().filter(|l| l.len() == 2) else { return fail("unexpected token", desc) };
                let (kind, index) = match desc.head() {
                    Some("func") => (ExternKind::Func, ctx.funcs.resolve(&dl[1], "function")?),
                    Some("table") => (ExternKind::Table, ctx.tables.resolve(&dl[1], "table")?),
                    Some("memory") => (ExternKind::Memory, ctx.memories.resolve(&dl[1], "memory")?),
                    Some("global") => (ExternKind::Global, ctx.globals.resolve(&dl[1], "global")?),
                    _ => return fail("unexpected token", desc),
                };
                m.exports.push(Export { name, kind, index });
            }
            "start" => {
                let [x] = items else { return fail("unexpected token", f) };
                if m.start.is_some() {
                    return fail("multiple start sections", f);
                }
                m.start = Some(ctx.funcs.resolve(x, "function")?);
            }
            "elem" => {
                let mut rest = items;
                let table = match rest.first() {
                    Some(s) if is_index(s) => {
                        rest = &rest[1..];
                        ctx.tables.resolve(s, "table")?
                    }
                    _ => 0,
                };
                let Some(off) = rest.first() else { return fail("unexpected token", f) };
                let offset = offset_expr(off, &mut ctx)?;
                let mut init = Vec::new();
                for s in &rest[1..] {
                    init.push(ctx.funcs.resolve(s, "function")?);
                }
                m.elems.push(Elem { table, offset, init });
            }
            "data" => {
                let mut rest = items;
                let memory = match rest.first() {
                    Some(s) if is_index(s) => {
                        rest = &rest[1..];
                        ctx.memories.resolve(s, "memory")?
                    }
                    _ => 0,
                };
                let Some(off) = rest.first() else { return fail("unexpected token", f) };
                let offset = offset_expr(off, &mut ctx)?;
                let mut bytes = Vec::new();
                for s in &rest[1..] {
                    match s.string() {
                        Some(b) => bytes.extend_from_slice(b),
                        None => return fail("unexpected token", s),
                    }
                }
                m.datas.push(Data { memory, offset, bytes });
            }
            _ => unreachable!(),
        }
    }
    m.types = ctx.types;
    Ok(m)
}

fn table_type(items: &[Sexp], at: &Sexp) -> Result<Limits> {
    match items.split_last() {
        Some((last, lim)) if last.atom() == Some("funcref") => limits(lim, at),
        _ => fail("unexpected token", at),
    }
}

fn import_desc(kind: &str, items: &[Sexp], at: &Sexp, ctx: &mut Ctx) -> Result<ImportDesc> {
    Ok(match kind {
        "func" => {
            let (tu, used) = parse_typeuse(items, ctx, true)?;
            if used != items.len() {
                return fail("unexpected token", &items[used]);
            }
            ImportDesc::Func(resolve_typeuse(&tu, &mut ctx.types, at)?)
        }
        "table" => ImportDesc::Table(table_type(items, at)?),
        "memory" => ImportDesc::Memory(limits(items, at)?),
        "global" => {
            let [t] = items else { return fail("unexpected token", at) };
            ImportDesc::Global(global_type(t)?)
        }
        _ => return fail("unexpected token", at),
    })
}

/// `(offset instr*)` or a single folded instruction.
fn offset_expr(s: &Sexp, ctx: &mut Ctx) -> Result<Vec<Instr>> {
    if s.is_form("offset") {
        const_expr(&s.list().unwrap()[1..], ctx, s)
    } else if s.list().is_some() {
        const_expr(std::slice::from_ref(s), ctx, s)
    } else {
        fail("unexpected token", s)
    }
}

fn const_expr(items: &[Sexp], ctx: &mut Ctx, _at: &Sexp) -> Result<Vec<Instr>> {
    let mut b = Body::new(ctx, Space::default());
    b.instrs(items)?;
    let mut out = b.out;
    out.push(Instr::End);
    Ok(out)
}

fn parse_func(items: &[Sexp], name: Option<&str>, at: &Sexp, ctx: &mut Ctx) -> Result<Func> {
    let (tu, used) = parse_typeuse(items, ctx, true)?;
    let type_idx = resolve_typeuse(&tu, &mut ctx.types, at)?;
    let mut locals_space = Space::default();
    let mut local_names = Vec::new();
    // Parameters come from the inline list, or from the referenced type when there is none.
    let param_count = if tu.inline || tu.index.is_none() {
        for (n, _) in &tu.params {
            locals_space.add(n.as_deref(), at, "local")?;
            local_names.push(n.clone());
        }
        tu.params.len()
    } else {
        let n = ctx.types.get(type_idx as usize).map(|t| t.params.len()).unwrap_or(0);
        for _ in 0..n {
            locals_space.add(None, at, "local")?;
            local_names.push(None);
        }
        n
    };
    let _ = param_count;
    let mut rest = &items[used..];
    let mut locals = Vec::new();
    while let Some(s) = rest.first().filter(|s| s.is_form("local")) {
        let l = &s.list().unwrap()[1..];
        if let Some(n) = l.first().and_then(|x| x.id()) {
            if l.len() != 2 {
                return fail("unexpected token", s);
            }
            locals_space.add(Some(n), s, "local")?;
            local_names.push(Some(n.to_string()));
            locals.push(valtype(&l[1])?);
        } else {
            for t in l {
                locals_space.add(None, s, "local")?;
                local_names.push(None);
                locals.push(valtype(t)?);
            }
        }
        rest = &rest[1..];
    }
    let mut b = Body::new(ctx, locals_space);
    b.instrs(rest)?;
    let end_offset = match at {
        Sexp::List(_, _, close) => *close,
        _ => at.offset(),
    };
    let mut body = b.out;
    let mut offsets = b.offsets;
    body.push(Instr::End);
    offsets.push(end_offset as u32);
    link_blocks(&mut body).map_err(|e| ParseError { message: e.into(), offset: at.offset() })?;
    Ok(Func { type_idx, locals, body, name: name.map(String::from), local_names, offsets })
}

// ---------------------------------------------------------------- instructions

struct Body<'c> {
    ctx: &'c mut Ctx,
    locals: Space,
    labels: Vec<Option<String>>,
    out: Vec<Instr>,
    offsets: Vec<u32>,
}

impl<'c> Body<'c> {
    fn new(ctx: &'c mut Ctx, locals: Space) -> Self {
        Body { ctx, locals, labels: Vec::new(), out: Vec::new(), offsets: Vec::new() }
    }

    fn emit(&mut self, i: Instr, at: usize) {
        self.out.push(i);
        self.offsets.push(at as u32);
    }

    fn label(&self, s: &Sexp) -> Result<u32> {
        match s {
            Sexp::Tok(Tok::Id(n), _) => match self.labels.iter().rev().position(|l| l.as_deref() == Some(n)) {
                Some(depth) => Ok(depth as u32),
                None => fail("unknown label", s),
            },
            _ => self.locals_like_nat(s),
        }
    }

    fn locals_like_nat(&self, s: &Sexp) -> Result<u32> {
        match s.atom().and_then(parse_nat) {
            Some(v) if v <= u32::MAX as u64 => Ok(v as u32),
            Some(_) => fail("constant out of range", s),
            None => fail("unexpected token", s),
        }
    }

    /// `$label? (result t)*`, returning the label and block type and how many items were used.
    fn block_header(&self, items: &[Sexp]) -> Result<(Option<String>, BlockType, usize)> {
        let mut i = 0;
        let label = items.first().and_then(|s| s.id()).map(String::from);
        if label.is_some() {
            i += 1;
        }
        let mut results = Vec::new();
        while let Some(s) = items.get(i).filter(|s| s.is_form("result")) {
            for t in &s.list().unwrap()[1..] {
                results.push(valtype(t)?);
            }
            i += 1;
        }
        let ty = match results.as_slice() {
            [] => BlockType::Empty,
            [t] => BlockType::Value(*t),
            _ => return fail("multiple block results are not supported in WebAssembly 1.0", &items[i - 1]),
        };
        Ok((label, ty, i))
    }

    /// A flat sequence of instructions (plain and folded mixed).
    fn instrs(&mut self, items: &[Sexp]) -> Result<()> {
        let mut i = 0;
        // Open plain blocks in this sequence: (kind, label)
        let mut open: Vec<(&'static str, Option<String>)> = Vec::new();
        while i < items.len() {
            let s = &items[i];
            if let Sexp::List(..) = s {
                self.folded(s)?;
                i += 1;
                continue;
            }
            let Some(op) = s.atom() else { return fail("unexpected token", s) };
            let at = s.offset();
            i += 1;
            match op {
                "block" | "loop" | "if" => {
                    let (label, ty, used) = self.block_header(&items[i..])?;
                    i += used;
                    let ins = match op {
                        "block" => Instr::Block { ty, end: UNLINKED },
                        "loop" => Instr::Loop { ty, end: UNLINKED },
                        _ => Instr::If { ty, else_: UNLINKED, end: UNLINKED },
                    };
                    self.emit(ins, at);
                    self.labels.push(label.clone());
                    open.push((if op == "if" { "if" } else { "block" }, label));
                }
                "else" | "end" => {
                    let Some((kind, label)) = open.last().cloned() else { return fail("unexpected token", s) };
                    if let Some(id) = items.get(i).and_then(|x| x.id()) {
                        if label.as_deref() != Some(id) {
                            return fail("mismatching label", &items[i]);
                        }
                        i += 1;
                    }
                    if op == "else" {
                        if kind != "if" {
                            return fail("unexpected token", s);
                        }
                        open.last_mut().unwrap().0 = "else";
                        self.emit(Instr::Else { end: UNLINKED }, at);
                    } else {
                        open.pop();
                        self.labels.pop();
                        self.emit(Instr::End, at);
                    }
                }
                _ => {
                    let used = self.plain(op, &items[i..], s)?;
                    i += used;
                }
            }
        }
        if let Some(_unclosed) = open.last() {
            return fail("unexpected end", items.last().unwrap());
        }
        Ok(())
    }

    /// `(op immediates… operands…)`, `(block …)`, `(loop …)`, `(if … (then …) (else …))`.
    fn folded(&mut self, s: &Sexp) -> Result<()> {
        let l = s.list().unwrap();
        let Some(head) = l.first() else { return fail("unexpected token", s) };
        let Some(op) = head.atom() else { return fail("unexpected token", head) };
        let at = head.offset();
        let rest = &l[1..];
        match op {
            "block" | "loop" => {
                let (label, ty, used) = self.block_header(rest)?;
                self.emit(if op == "block" { Instr::Block { ty, end: UNLINKED } } else { Instr::Loop { ty, end: UNLINKED } }, at);
                self.labels.push(label);
                self.instrs(&rest[used..])?;
                self.labels.pop();
                let end_at = if let Sexp::List(_, _, close) = s { *close } else { at };
                self.emit(Instr::End, end_at);
            }
            "if" => {
                let (label, ty, used) = self.block_header(rest)?;
                let mut j = used;
                while let Some(c) = rest.get(j).filter(|c| c.list().is_some() && !c.is_form("then")) {
                    self.folded(c)?;
                    j += 1;
                }
                let Some(then) = rest.get(j).filter(|c| c.is_form("then")) else {
                    return fail("unexpected token", rest.get(j).unwrap_or(s));
                };
                j += 1;
                let els = rest.get(j).filter(|c| c.is_form("else"));
                if els.is_some() {
                    j += 1;
                }
                if j != rest.len() {
                    return fail("unexpected token", &rest[j]);
                }
                self.emit(Instr::If { ty, else_: UNLINKED, end: UNLINKED }, at);
                self.labels.push(label);
                self.instrs(&then.list().unwrap()[1..])?;
                if let Some(e) = els {
                    self.emit(Instr::Else { end: UNLINKED }, e.offset());
                    self.instrs(&e.list().unwrap()[1..])?;
                }
                self.labels.pop();
                let end_at = if let Sexp::List(_, _, close) = s { *close } else { at };
                self.emit(Instr::End, end_at);
            }
            _ => {
                // Immediates are the leading non-list items; the rest are folded operands.
                let n_imm = rest.iter().take_while(|x| x.list().is_none()).count();
                // call_indirect's typeuse is made of lists; it is part of the immediates.
                let typeuse_len = if op == "call_indirect" {
                    rest.iter().take_while(|x| x.is_form("type") || x.is_form("param") || x.is_form("result")).count()
                } else {
                    0
                };
                let imm_end = n_imm.max(typeuse_len);
                for operand in &rest[imm_end..] {
                    if operand.list().is_none() {
                        return fail("unexpected token", operand);
                    }
                    self.folded(operand)?;
                }
                let used = self.plain(op, &rest[..imm_end], head)?;
                if used != imm_end {
                    return fail("unexpected token", &rest[used]);
                }
            }
        }
        Ok(())
    }

    /// One plain (non-block) instruction with its immediates; returns how many items it used.
    fn plain(&mut self, op: &str, imm: &[Sexp], at_s: &Sexp) -> Result<usize> {
        let at = at_s.offset();
        let need = |n: usize| -> Result<()> {
            if imm.len() < n {
                return fail("unexpected token", at_s);
            }
            Ok(())
        };
        let simple = match op {
            "unreachable" => Some(Instr::Unreachable),
            "nop" => Some(Instr::Nop),
            "return" => Some(Instr::Return),
            "drop" => Some(Instr::Drop),
            "select" => Some(Instr::Select),
            "memory.size" => Some(Instr::MemorySize),
            "memory.grow" => Some(Instr::MemoryGrow),
            _ => None,
        };
        if let Some(ins) = simple {
            self.emit(ins, at);
            return Ok(0);
        }
        if let Some(n) = num_op_by_name(op) {
            self.emit(Instr::Num(n.code), at);
            return Ok(0);
        }
        if let Some(mop) = mem_op_by_name(op) {
            let mut used = 0;
            let mut offset = 0u32;
            let mut align = None;
            if let Some(v) = imm.get(used).and_then(|s| s.atom()).and_then(|a| a.strip_prefix("offset=")) {
                offset = match parse_nat(v) {
                    Some(x) if x <= u32::MAX as u64 => x as u32,
                    Some(_) => return fail("constant out of range", &imm[used]),
                    None => return fail("unknown operator", &imm[used]),
                };
                used += 1;
            }
            if let Some(v) = imm.get(used).and_then(|s| s.atom()).and_then(|a| a.strip_prefix("align=")) {
                let a = match parse_nat(v) {
                    Some(x) if x <= u32::MAX as u64 => x as u32,
                    _ => return fail("unknown operator", &imm[used]),
                };
                if !a.is_power_of_two() {
                    return fail("alignment", &imm[used]);
                }
                align = Some(a.trailing_zeros());
                used += 1;
            }
            let arg = MemArg { align: align.unwrap_or(mop.bytes.trailing_zeros()), offset };
            self.emit(if crate::opcodes::is_store(mop.code) { Instr::Store(mop.code, arg) } else { Instr::Load(mop.code, arg) }, at);
            return Ok(used);
        }
        let ins = match op {
            "br" | "br_if" => {
                need(1)?;
                let l = self.label(&imm[0])?;
                self.emit(if op == "br" { Instr::Br(l) } else { Instr::BrIf(l) }, at);
                return Ok(1);
            }
            "br_table" => {
                let n = imm.iter().take_while(|s| is_index(s)).count();
                if n == 0 {
                    return fail("unexpected token", at_s);
                }
                let mut ls = Vec::with_capacity(n);
                for s in &imm[..n] {
                    ls.push(self.label(s)?);
                }
                let default = ls.pop().unwrap();
                self.emit(Instr::BrTable(ls.into_boxed_slice(), default), at);
                return Ok(n);
            }
            "call" => {
                need(1)?;
                Instr::Call(self.ctx.funcs.resolve(&imm[0], "function")?)
            }
            "call_indirect" => {
                let (tu, used) = parse_typeuse(imm, self.ctx, false)?;
                let t = resolve_typeuse(&tu, &mut self.ctx.types, at_s)?;
                self.emit(Instr::CallIndirect(t), at);
                return Ok(used);
            }
            "local.get" | "local.set" | "local.tee" => {
                need(1)?;
                let x = self.locals.resolve(&imm[0], "local")?;
                match op {
                    "local.get" => Instr::LocalGet(x),
                    "local.set" => Instr::LocalSet(x),
                    _ => Instr::LocalTee(x),
                }
            }
            "global.get" | "global.set" => {
                need(1)?;
                let x = self.ctx.globals.resolve(&imm[0], "global")?;
                if op == "global.get" { Instr::GlobalGet(x) } else { Instr::GlobalSet(x) }
            }
            "i32.const" | "i64.const" => {
                need(1)?;
                let Some(text) = imm[0].atom() else { return fail("unexpected token", &imm[0]) };
                let bits = if op == "i32.const" { 32 } else { 64 };
                let v = parse_int(text, bits).or_else(|e| fail(e, &imm[0]))?;
                if bits == 32 { Instr::I32Const(v as u32 as i32) } else { Instr::I64Const(v as i64) }
            }
            "f32.const" => {
                need(1)?;
                Instr::F32Const(parse_float_lit(&imm[0], float::F32)? as u32)
            }
            "f64.const" => {
                need(1)?;
                Instr::F64Const(parse_float_lit(&imm[0], float::F64)?)
            }
            _ => return fail("unknown operator", at_s),
        };
        self.emit(ins, at);
        Ok(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folded_and_flat_forms_agree() {
        let a = parse_module_text("(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))").unwrap();
        let b = parse_module_text("(module (func (result i32) i32.const 1 i32.const 2 i32.add))").unwrap();
        assert_eq!(a.funcs[0].body, b.funcs[0].body);
        assert_eq!(a.funcs[0].body, vec![Instr::I32Const(1), Instr::I32Const(2), Instr::Num(0x6a), Instr::End]);
    }

    #[test]
    fn resolves_names_labels_and_implicit_types() {
        let m = parse_module_text(
            "(module (type $t (func (param i32)))
               (func $f (param $x i32) (result i32)
                 (block $out (result i32) (br_if $out (local.get $x) (local.get $x)) (i32.const 7)))
               (func (export \"g\") (call $f (i32.const 1)) drop))",
        )
        .unwrap();
        assert_eq!(m.types.len(), 3); // [i32]->[], [i32]->[i32], []->[]
        assert_eq!(m.funcs[0].type_idx, 1);
        assert_eq!(m.funcs[0].body[0], Instr::Block { ty: BlockType::Value(ValType::I32), end: 5 });
        assert_eq!(m.funcs[0].body[3], Instr::BrIf(0));
        assert_eq!(m.funcs[1].body[1], Instr::Call(0));
        assert_eq!(m.exports[0], Export { name: "g".into(), kind: ExternKind::Func, index: 1 });
    }

    #[test]
    fn if_then_else_and_abbreviations() {
        let m = parse_module_text(
            "(module (memory (data \"hi\")) (table funcref (elem $a))
               (func $a (if (i32.const 1) (then nop) (else nop))))",
        )
        .unwrap();
        assert_eq!(m.memories[0], Limits { min: 1, max: Some(1) });
        assert_eq!(m.datas[0].bytes, b"hi");
        assert_eq!(m.tables[0], Limits { min: 1, max: Some(1) });
        assert_eq!(
            m.funcs[0].body,
            vec![Instr::I32Const(1), Instr::If { ty: BlockType::Empty, else_: 3, end: 5 }, Instr::Nop, Instr::Else { end: 5 }, Instr::Nop, Instr::End, Instr::End]
        );
    }

    #[test]
    fn rejects_malformed_text() {
        let bad = |s: &str| parse_module_text(s).unwrap_err().message;
        assert_eq!(bad("(module (func block $a end $b))"), "mismatching label");
        assert_eq!(bad("(module (func i32.const 0x100000000 drop))"), "constant out of range");
        assert_eq!(bad("(module (func (br $nowhere)))"), "unknown label");
        assert_eq!(bad("(module (func i32.foo))"), "unknown operator");
        assert_eq!(bad("(module (type $t (func)) (func (type $t) (param i32)))"), "inline function type");
        assert_eq!(bad("(module (func) (import \"a\" \"b\" (func)))"), "import after function");
        assert_eq!(bad("(module (func (i32.load align=3 (i32.const 0)) drop))"), "alignment");
        // Valid text but invalid module: left for the validator.
        assert!(parse_module_text("(module (func (result i32) (i64.const 1)))").is_ok());
        assert!(parse_module_text("(module (func br 9))").is_ok());
    }

    #[test]
    fn integer_literal_ranges() {
        assert_eq!(parse_int("-0x8000_0000", 32), Ok(0x8000_0000));
        assert_eq!(parse_int("0xffff_ffff", 32), Ok(0xffff_ffff));
        assert_eq!(parse_int("-0x8000_0001", 32), Err("constant out of range"));
        assert_eq!(parse_int("18446744073709551615", 64), Ok(u64::MAX));
        assert_eq!(parse_int("1_", 32), Err("unknown operator"));
        assert_eq!(parse_int("0x1_0000_0000", 32), Err("constant out of range"));
    }
}
