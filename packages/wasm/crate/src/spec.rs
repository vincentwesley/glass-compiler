//! Runs `.wast` spec scripts: modules, `register`, `invoke`/`get` actions and
//! every `assert_*` command of the WebAssembly 1.0 testsuite.
//!
//! Grading: `assert_malformed`, `assert_invalid` and `assert_unlinkable` pass
//! when the module is rejected at the right stage (decode/parse, validation,
//! linking). `assert_trap` and `assert_exhaustion` also require the trap
//! message to start with the expected text, as the reference interpreter does.

use std::collections::HashMap;
use std::rc::Rc;

use crate::binary;
use crate::float;
use crate::module::*;
use crate::runtime::*;
use crate::text::lexer::{parse_sexps, Sexp, Tok};
use crate::text::parser::{parse_int, parse_module_fields, parse_module_text};
use crate::validate::validate;

#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub line: usize,
    pub command: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FileResult {
    pub passed: usize,
    pub failed: usize,
    pub failures: Vec<Failure>,
}

impl FileResult {
    pub fn total(&self) -> usize {
        self.passed + self.failed
    }
}

/// Why a module was rejected, by stage.
#[derive(Debug)]
enum Reject {
    Malformed(String),
    Invalid(String),
    Unlinkable(String),
    Trap(String),
}

impl Reject {
    fn describe(&self) -> String {
        match self {
            Reject::Malformed(m) => format!("malformed: {m}"),
            Reject::Invalid(m) => format!("invalid: {m}"),
            Reject::Unlinkable(m) => format!("unlinkable: {m}"),
            Reject::Trap(m) => format!("trap: {m}"),
        }
    }
}

pub struct Runner {
    pub store: Store,
    registry: HashMap<String, Rc<ModuleInst>>,
    named: HashMap<String, Rc<ModuleInst>>,
    current: Option<Rc<ModuleInst>>,
}

impl Default for Runner {
    fn default() -> Self {
        Self::new()
    }
}

impl Runner {
    pub fn new() -> Self {
        let mut r = Runner {
            store: Store::default(),
            registry: HashMap::new(),
            named: HashMap::new(),
            current: None,
        };
        r.add_spectest();
        r
    }

    /// The host module every spec script may import from.
    fn add_spectest(&mut self) {
        let s = &mut self.store;
        let mut exports = HashMap::new();
        let print = |params: Vec<ValType>| FuncType {
            params,
            results: vec![],
        };
        let host: HostFn = Rc::new(|store: &mut Store, args: &[Value]| {
            store.output.push(
                args.iter()
                    .map(|a| a.to_string())
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            Ok(vec![])
        });
        use ValType::*;
        for (name, params) in [
            ("print", vec![]),
            ("print_i32", vec![I32]),
            ("print_i64", vec![I64]),
            ("print_f32", vec![F32]),
            ("print_f64", vec![F64]),
            ("print_i32_f32", vec![I32, F32]),
            ("print_f64_f64", vec![F64, F64]),
        ] {
            let a = s.add_host_func(name, print(params), host.clone());
            exports.insert(name.to_string(), ExternVal::Func(a));
        }
        exports.insert(
            "global_i32".into(),
            ExternVal::Global(s.add_global(
                GlobalType {
                    ty: I32,
                    mutable: false,
                },
                Value::I32(666),
            )),
        );
        exports.insert(
            "global_i64".into(),
            ExternVal::Global(s.add_global(
                GlobalType {
                    ty: I64,
                    mutable: false,
                },
                Value::I64(666),
            )),
        );
        exports.insert(
            "global_f32".into(),
            ExternVal::Global(s.add_global(
                GlobalType {
                    ty: F32,
                    mutable: false,
                },
                Value::F32(666.6f32.to_bits()),
            )),
        );
        exports.insert(
            "global_f64".into(),
            ExternVal::Global(s.add_global(
                GlobalType {
                    ty: F64,
                    mutable: false,
                },
                Value::F64(666.6f64.to_bits()),
            )),
        );
        exports.insert(
            "table".into(),
            ExternVal::Table(s.add_table(Limits {
                min: 10,
                max: Some(20),
            })),
        );
        exports.insert(
            "memory".into(),
            ExternVal::Memory(
                s.add_memory(Limits {
                    min: 1,
                    max: Some(2),
                })
                .expect("the spectest memory is one page"),
            ),
        );
        let inst = ModuleInst {
            types: vec![],
            funcs: vec![],
            tables: vec![],
            memories: vec![],
            globals: vec![],
            exports,
        };
        self.registry.insert("spectest".into(), Rc::new(inst));
    }

    fn resolve_imports(&self, m: &Module) -> Result<Vec<ExternVal>, Reject> {
        let mut out = Vec::new();
        for imp in &m.imports {
            let Some(inst) = self.registry.get(&imp.module) else {
                return Err(Reject::Unlinkable(format!(
                    "unknown import {}.{}",
                    imp.module, imp.name
                )));
            };
            let Some(&v) = inst.exports.get(&imp.name) else {
                return Err(Reject::Unlinkable(format!(
                    "unknown import {}.{}",
                    imp.module, imp.name
                )));
            };
            out.push(v);
        }
        Ok(out)
    }

    /// Decodes or parses, validates and instantiates a `(module …)` form.
    fn build(
        &mut self,
        form: &Sexp,
        src: &str,
    ) -> Result<(Option<String>, Rc<ModuleInst>), Reject> {
        let (name, m) = module_of(form, src)?;
        validate(&m).map_err(|e| Reject::Invalid(e.message))?;
        let imports = self.resolve_imports(&m)?;
        let inst = self.store.instantiate(&m, &imports).map_err(|e| match e {
            InstantiateError::Unlinkable(s) => Reject::Unlinkable(s),
            InstantiateError::Trap(t) => Reject::Trap(t.0),
        })?;
        Ok((name, inst))
    }

    /// Validates and instantiates a module against the spectest host and registered modules.
    pub fn instantiate_module(&mut self, m: &Module) -> Result<Rc<ModuleInst>, String> {
        validate(m).map_err(|e| format!("invalid module: {}", e.message))?;
        let imports = self.resolve_imports(m).map_err(|r| r.describe())?;
        self.store.instantiate(m, &imports).map_err(|e| match e {
            InstantiateError::Unlinkable(s) => format!("can't link: {s}"),
            InstantiateError::Trap(t) => format!("trap while starting: {}", t.0),
        })
    }

    fn instance(&self, name: Option<&str>) -> Result<Rc<ModuleInst>, String> {
        match name {
            Some(n) => self
                .named
                .get(n)
                .cloned()
                .ok_or_else(|| format!("unknown module ${n}")),
            None => self
                .current
                .clone()
                .ok_or_else(|| "no module defined".to_string()),
        }
    }

    /// `(invoke $m? "name" args…)` or `(get $m? "name")`.
    fn action(&mut self, a: &Sexp) -> Result<Result<Vec<Value>, Trap>, String> {
        let l = a.list().ok_or("expected an action")?;
        let kind = l
            .first()
            .and_then(|h| h.atom())
            .ok_or("expected an action")?;
        let mut i = 1;
        let module = l.get(i).and_then(|s| s.id());
        if module.is_some() {
            i += 1;
        }
        let inst = self.instance(module)?;
        let name = l
            .get(i)
            .and_then(|s| s.string())
            .ok_or("expected an export name")?;
        let name = String::from_utf8(name.to_vec()).map_err(|_| "bad export name")?;
        let export = inst
            .exports
            .get(&name)
            .copied()
            .ok_or_else(|| format!("unknown export \"{name}\""))?;
        match (kind, export) {
            ("invoke", ExternVal::Func(f)) => {
                let mut args = Vec::new();
                for c in &l[i + 1..] {
                    args.push(const_value(c)?.ok_or("nan patterns are not arguments")?);
                }
                Ok(self.store.invoke(f, &args))
            }
            ("get", ExternVal::Global(g)) => Ok(Ok(vec![self.store.globals[g as usize].value])),
            _ => Err(format!("{kind} on a {} export", export.kind().name())),
        }
    }

    /// Runs every command in a script.
    pub fn run_script(&mut self, src: &str) -> FileResult {
        let mut res = FileResult::default();
        let cmds = match parse_sexps(src) {
            Ok(c) => c,
            Err(e) => {
                res.failed = 1;
                res.failures.push(Failure {
                    line: line_of(src, e.offset),
                    command: "script".into(),
                    message: e.message,
                });
                return res;
            }
        };
        // A script that is just module fields is one implicit module.
        if !cmds.is_empty() && !cmds.iter().all(|c| matches!(c.head(), Some(h) if h == "module" || h == "register" || h == "invoke" || h == "get" || h.starts_with("assert_"))) {
            let outcome = match parse_module_fields(&cmds) {
                Ok(m) => validate(&m).map_err(|e| e.message).map(|_| ()),
                Err(e) => Err(e.message),
            };
            match outcome {
                Ok(()) => res.passed += 1,
                Err(m) => {
                    res.failed += 1;
                    res.failures.push(Failure { line: 1, command: "module".into(), message: m });
                }
            }
            return res;
        }
        for c in &cmds {
            let head = c.head().unwrap_or("").to_string();
            match self.command(c, src) {
                Ok(()) => res.passed += 1,
                Err(message) => {
                    res.failed += 1;
                    res.failures.push(Failure {
                        line: line_of(src, c.offset()),
                        command: head,
                        message,
                    });
                }
            }
        }
        res
    }

    fn command(&mut self, c: &Sexp, src: &str) -> Result<(), String> {
        let l = c.list().ok_or("expected a command")?;
        let head = c.head().ok_or("expected a command")?;
        match head {
            "module" => {
                let (name, inst) = self.build(c, src).map_err(|r| r.describe())?;
                if let Some(n) = name {
                    self.named.insert(n, inst.clone());
                }
                self.current = Some(inst);
                Ok(())
            }
            "register" => {
                let name = l
                    .get(1)
                    .and_then(|s| s.string())
                    .ok_or("register needs a name")?;
                let inst = self.instance(l.get(2).and_then(|s| s.id()))?;
                self.registry
                    .insert(String::from_utf8_lossy(name).into_owned(), inst);
                Ok(())
            }
            "invoke" | "get" => match self.action(c)? {
                Ok(_) => Ok(()),
                Err(t) => Err(format!("unexpected trap: {}", t.0)),
            },
            "assert_return" => {
                let got = self
                    .action(l.get(1).ok_or("missing action")?)?
                    .map_err(|t| format!("unexpected trap: {}", t.0))?;
                let mut want = Vec::new();
                for e in &l[2..] {
                    want.push(const_value(e)?);
                }
                if got.len() != want.len() {
                    return Err(format!(
                        "expected {} results, got {}",
                        want.len(),
                        got.len()
                    ));
                }
                for (g, w) in got.iter().zip(&want) {
                    match w {
                        Some(w) if g == w => {}
                        Some(w) => return Err(format!("expected {w}, got {g}")),
                        None => {}
                    }
                }
                Ok(())
            }
            "assert_return_canonical_nan" | "assert_return_arithmetic_nan" => {
                let got = self
                    .action(l.get(1).ok_or("missing action")?)?
                    .map_err(|t| format!("unexpected trap: {}", t.0))?;
                let canonical = head.ends_with("canonical_nan");
                let ok = match got.as_slice() {
                    [Value::F32(b)] => {
                        if canonical {
                            float::is_canonical_nan32(*b)
                        } else {
                            float::is_arithmetic_nan32(*b)
                        }
                    }
                    [Value::F64(b)] => {
                        if canonical {
                            float::is_canonical_nan64(*b)
                        } else {
                            float::is_arithmetic_nan64(*b)
                        }
                    }
                    _ => false,
                };
                if ok {
                    Ok(())
                } else {
                    Err(format!(
                        "expected a {} NaN, got {}",
                        if canonical { "canonical" } else { "arithmetic" },
                        show(&got)
                    ))
                }
            }
            "assert_trap" | "assert_exhaustion" => {
                let target = l.get(1).ok_or("missing action")?;
                let expected = l
                    .get(2)
                    .and_then(|s| s.string())
                    .map(|s| String::from_utf8_lossy(s).into_owned())
                    .unwrap_or_default();
                let message = if target.is_form("module") {
                    match self.build(target, src) {
                        Ok(_) => return Err("expected a trap, but the module instantiated".into()),
                        Err(Reject::Trap(m)) => m,
                        Err(r) => return Err(format!("expected a trap, got {}", r.describe())),
                    }
                } else {
                    match self.action(target)? {
                        Ok(v) => {
                            return Err(format!("expected trap \"{expected}\", got {}", show(&v)))
                        }
                        Err(t) => t.0,
                    }
                };
                if message.starts_with(&expected) {
                    Ok(())
                } else {
                    Err(format!("expected trap \"{expected}\", got \"{message}\""))
                }
            }
            "assert_malformed" | "assert_invalid" | "assert_unlinkable" => {
                let target = l.get(1).ok_or("missing module")?;
                let outcome = self.build(target, src);
                match (head, outcome) {
                    ("assert_malformed", Err(Reject::Malformed(_))) => Ok(()),
                    ("assert_invalid", Err(Reject::Invalid(_))) => Ok(()),
                    ("assert_unlinkable", Err(Reject::Unlinkable(_))) => Ok(()),
                    (_, Ok(_)) => Err("the module was accepted".into()),
                    (_, Err(r)) => Err(format!("rejected at the wrong stage: {}", r.describe())),
                }
            }
            other => Err(format!("unknown command {other}")),
        }
    }
}

fn show(v: &[Value]) -> String {
    if v.is_empty() {
        "no results".into()
    } else {
        v.iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn line_of(src: &str, offset: usize) -> usize {
    src[..offset.min(src.len())]
        .bytes()
        .filter(|&b| b == b'\n')
        .count()
        + 1
}

/// `(module $id? …)`, `(module $id? binary "…"*)` or `(module $id? quote "…"*)` to a Module.
fn module_of(form: &Sexp, src: &str) -> Result<(Option<String>, Module), Reject> {
    let l = form
        .list()
        .ok_or_else(|| Reject::Malformed("expected a module".into()))?;
    let mut i = 1;
    let name = l.get(1).and_then(|s| s.id()).map(String::from);
    if name.is_some() {
        i += 1;
    }
    let concat = |items: &[Sexp]| -> Result<Vec<u8>, Reject> {
        let mut out = Vec::new();
        for s in items {
            out.extend_from_slice(
                s.string()
                    .ok_or_else(|| Reject::Malformed("expected a string".into()))?,
            );
        }
        Ok(out)
    };
    let m = match l.get(i).and_then(|s| s.atom()) {
        Some("binary") => {
            binary::decode(&concat(&l[i + 1..])?).map_err(|e| Reject::Malformed(e.message))?
        }
        Some("quote") => {
            let text = String::from_utf8(concat(&l[i + 1..])?)
                .map_err(|_| Reject::Malformed("malformed UTF-8 encoding".into()))?;
            parse_module_text(&text).map_err(|e| Reject::Malformed(e.message))?
        }
        _ => {
            let _ = src;
            parse_module_fields(&l[i..]).map_err(|e| Reject::Malformed(e.message))?
        }
    };
    Ok((name, m))
}

/// `(i32.const 1)` etc. `Ok(None)` is a NaN pattern that matches any NaN of that type.
fn const_value(s: &Sexp) -> Result<Option<Value>, String> {
    let l = s.list().ok_or("expected a constant")?;
    let (Some(op), Some(arg)) = (l.first().and_then(|h| h.atom()), l.get(1)) else {
        return Err("expected a constant".into());
    };
    let text = match arg {
        Sexp::Tok(Tok::Atom(a), _) => a.as_str(),
        _ => return Err("expected a number".into()),
    };
    Ok(Some(match op {
        "i32.const" => Value::I32(parse_int(text, 32)? as u32 as i32),
        "i64.const" => Value::I64(parse_int(text, 64)? as i64),
        "f32.const" => {
            if text.starts_with("nan:") && !text.starts_with("nan:0x") {
                return Ok(None);
            }
            Value::F32(float::parse(text, float::F32).map_err(|e| format!("{e:?}"))? as u32)
        }
        "f64.const" => {
            if text.starts_with("nan:") && !text.starts_with("nan:0x") {
                return Ok(None);
            }
            Value::F64(float::parse(text, float::F64).map_err(|e| format!("{e:?}"))?)
        }
        _ => return Err(format!("unknown constant {op}")),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_a_small_script() {
        let src = r#"
(module
  (func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
  (func (export "div") (param i32 i32) (result i32) (i32.div_s (local.get 0) (local.get 1)))
  (func (export "fac") (param i64) (result i64)
    (if (result i64) (i64.eqz (local.get 0))
      (then (i64.const 1))
      (else (i64.mul (local.get 0) (call 2 (i64.sub (local.get 0) (i64.const 1)))))))
  (func (export "loop") (result i32) (call 3))
  (global (export "g") i32 (i32.const 42))
)
(assert_return (invoke "add" (i32.const 1) (i32.const 2)) (i32.const 3))
(assert_return (invoke "fac" (i64.const 20)) (i64.const 2432902008176640000))
(assert_trap (invoke "div" (i32.const 1) (i32.const 0)) "integer divide by zero")
(assert_exhaustion (invoke "loop") "call stack exhausted")
(assert_return (get "g") (i32.const 42))
(assert_invalid (module (func (result i32) (i64.const 0))) "type mismatch")
(assert_malformed (module quote "(func i32.nope)") "unknown operator")
(assert_malformed (module binary "\00asm\02\00\00\00") "unknown binary version")
(assert_unlinkable (module (import "spectest" "nope" (func))) "unknown import")
(module $M (func (export "f") (result i32) (i32.const 7)))
(register "M" $M)
(module (import "M" "f" (func $f (result i32))) (func (export "g") (result i32) (call $f)))
(assert_return (invoke "g") (i32.const 7))
(assert_return_canonical_nan (invoke $M "f"))
"#;
        let mut r = Runner::new();
        let res = r.run_script(src);
        assert_eq!(res.passed, 14, "{:#?}", res.failures);
        assert_eq!(res.failed, 1);
        assert_eq!(res.failures[0].command, "assert_return_canonical_nan");
    }
}
