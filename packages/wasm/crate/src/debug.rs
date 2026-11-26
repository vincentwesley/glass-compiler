//! The debugger's view of a module and of a run, as JSON for the web page.
//!
//! A run is deterministic, so the page can ask for the machine state after
//! any step `n`: the session replays from the start and stops there. That
//! gives stepping backwards and scrubbing for free.

use std::rc::Rc;

use crate::disasm::func_lines;
use crate::json::string as js;
use crate::module::*;
use crate::runtime::{ModuleInst, Thread, Trap};
use crate::spec::Runner;
use crate::text::parse_module_text;

/// Runs longer than this stop with status "limit", so a runaway loop can't freeze the page.
pub const MAX_STEPS: u64 = 200_000;

pub struct Session {
    pub module: Module,
    runner: Runner,
    inst: Option<Rc<ModuleInst>>,
    thread: Thread,
    /// (function index, pc) of the instruction each step of the last full run executed.
    pub trace: Vec<(u32, u32)>,
    recording: bool,
}

fn value_json(v: &Value) -> String {
    let (ty, text, bits) = match *v {
        Value::I32(x) => ("i32", x.to_string(), format!("0x{:08x}", x as u32)),
        Value::I64(x) => ("i64", x.to_string(), format!("0x{:016x}", x as u64)),
        Value::F32(b) => ("f32", crate::float::fmt_f32(b), format!("0x{b:08x}")),
        Value::F64(b) => ("f64", crate::float::fmt_f64(b), format!("0x{b:016x}")),
    };
    format!("{{\"type\":\"{ty}\",\"value\":{},\"bits\":\"{bits}\"}}", js(&text))
}

/// Parses a text-format value like `i32:5`, `f64:-1.5` or plain `5` (typed by `ty`).
pub fn parse_arg(text: &str, ty: ValType) -> Result<Value, String> {
    let t = text.trim();
    let bad = || format!("\"{t}\" is not a valid {ty}");
    Ok(match ty {
        ValType::I32 => Value::I32(crate::text::parser::parse_int(t, 32).map_err(|_| bad())? as u32 as i32),
        ValType::I64 => Value::I64(crate::text::parser::parse_int(t, 64).map_err(|_| bad())? as i64),
        ValType::F32 => Value::F32(crate::float::parse(t, crate::float::F32).map_err(|_| bad())? as u32),
        ValType::F64 => Value::F64(crate::float::parse(t, crate::float::F64).map_err(|_| bad())?),
    })
}

impl Session {
    /// Parses (text) or decodes (binary), validates and instantiates a module.
    pub fn load_text(src: &str) -> Result<Session, String> {
        let module = parse_module_text(src).map_err(|e| {
            let line = src[..e.offset.min(src.len())].bytes().filter(|&b| b == b'\n').count() + 1;
            format!("line {line}: {}", e.message)
        })?;
        Self::from_module(module)
    }

    pub fn load_binary(bytes: &[u8]) -> Result<Session, String> {
        let module = crate::binary::decode(bytes).map_err(|e| format!("byte {}: {}", e.offset, e.message))?;
        Self::from_module(module)
    }

    fn from_module(module: Module) -> Result<Session, String> {
        let mut s = Session { module, runner: Runner::new(), inst: None, thread: Thread::default(), trace: Vec::new(), recording: false };
        s.reset()?;
        Ok(s)
    }

    /// A fresh store and instance (so every run starts from the same state).
    fn reset(&mut self) -> Result<(), String> {
        self.runner = Runner::new();
        self.inst = Some(self.runner.instantiate_module(&self.module)?);
        self.thread = Thread::default();
        Ok(())
    }

    fn func_name(&self, idx: u32) -> String {
        let imported = self.module.imported(ExternKind::Func) as u32;
        if idx < imported {
            let mut n = 0;
            for imp in &self.module.imports {
                if let ImportDesc::Func(_) = imp.desc {
                    if n == idx {
                        return format!("{}.{}", imp.module, imp.name);
                    }
                    n += 1;
                }
            }
        }
        let f = &self.module.funcs[(idx - imported) as usize];
        if let Some(n) = &f.name {
            return format!("${n}");
        }
        for e in &self.module.exports {
            if e.kind == ExternKind::Func && e.index == idx {
                return format!("\"{}\"", e.name);
            }
        }
        format!("func {idx}")
    }

    /// The module's functions (as indented instruction lines with source offsets) and exports.
    pub fn describe(&self) -> String {
        let imported = self.module.imported(ExternKind::Func);
        let funcs: Vec<String> = self
            .module
            .funcs
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let idx = (imported + i) as u32;
                let ty = &self.module.types[f.type_idx as usize];
                let lines: Vec<String> = func_lines(&self.module, f)
                    .iter()
                    .enumerate()
                    .map(|(pc, l)| format!("{{\"depth\":{},\"text\":{},\"offset\":{}}}", l.depth, js(&l.text), f.offsets.get(pc).map(|o| *o as i64).unwrap_or(-1)))
                    .collect();
                format!("{{\"index\":{idx},\"name\":{},\"type\":{},\"lines\":[{}]}}", js(&self.func_name(idx)), js(&ty.to_string()), lines.join(","))
            })
            .collect();
        let exports: Vec<String> = self
            .module
            .exports
            .iter()
            .map(|e| {
                let params = match e.kind {
                    ExternKind::Func => self.module.func_type(e.index).map(|t| t.params.iter().map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(",")).unwrap_or_default(),
                    _ => String::new(),
                };
                format!("{{\"name\":{},\"kind\":\"{}\",\"index\":{},\"params\":[{params}]}}", js(&e.name), e.kind.name(), e.index)
            })
            .collect();
        format!("{{\"funcs\":[{}],\"exports\":[{}],\"memories\":{}}}", funcs.join(","), exports.join(","), self.module.memory_count())
    }

    /// Runs export `name` with `args`, stopping after `stop_at` steps (or at the end).
    /// Returns the machine state as JSON, plus the total number of steps the run takes.
    pub fn run(&mut self, name: &str, args: &[String], stop_at: Option<u64>) -> Result<String, String> {
        let total = {
            self.reset()?;
            self.trace.clear();
            self.recording = true;
            let r = self.drive(name, args, None);
            self.recording = false;
            let (status, _, _) = r?;
            let steps = self.thread.steps;
            (steps, status)
        };
        self.reset()?;
        let (status, trap, results) = self.drive(name, args, stop_at)?;
        Ok(self.state_json(status, trap, results, total.0, total.1))
    }

    fn drive(&mut self, name: &str, args: &[String], stop_at: Option<u64>) -> Result<(&'static str, Option<Trap>, Vec<Value>), String> {
        let inst = self.inst.clone().unwrap();
        let Some(crate::runtime::ExternVal::Func(f)) = inst.exports.get(name).copied() else { return Err(format!("no exported function \"{name}\"")) };
        let ty = self.runner.store.funcs[f as usize].ty().clone();
        if args.len() != ty.params.len() {
            return Err(format!("\"{name}\" takes {} argument{}", ty.params.len(), if ty.params.len() == 1 { "" } else { "s" }));
        }
        let vals: Vec<Value> = args.iter().zip(&ty.params).map(|(a, t)| parse_arg(a, *t)).collect::<Result<_, _>>()?;
        let store = &mut self.runner.store;
        if let Err(t) = self.thread.start(store, f, &vals) {
            return Ok(("trap", Some(t), vec![]));
        }
        loop {
            if self.thread.done() {
                return Ok(("finished", None, self.thread.results()));
            }
            if stop_at.is_some_and(|n| self.thread.steps >= n) {
                return Ok(("paused", None, vec![]));
            }
            if self.thread.steps >= MAX_STEPS {
                return Ok(("limit", Some(Trap::new(&format!("stopped after {MAX_STEPS} steps")) ), vec![]));
            }
            if self.recording {
                let f = self.thread.frames.last().unwrap();
                self.trace.push((f.code_index, f.pc as u32));
            }
            if let Err(t) = self.thread.step(store) {
                return Ok(("trap", Some(t), vec![]));
            }
        }
    }

    fn state_json(&self, status: &str, trap: Option<Trap>, results: Vec<Value>, total: u64, final_status: &str) -> String {
        let t = &self.thread;
        let store = &self.runner.store;
        let stack: Vec<String> = t.stack.iter().map(value_json).collect();
        let frames: Vec<String> = t
            .frames
            .iter()
            .map(|f| {
                let names = &f.code.local_names;
                let ty = store.funcs[f.func as usize].ty();
                let locals: Vec<String> = f
                    .locals
                    .iter()
                    .enumerate()
                    .map(|(i, v)| {
                        let n = names.get(i).and_then(|n| n.as_deref()).map(|n| format!("${n}")).unwrap_or_else(|| i.to_string());
                        let role = if i < ty.params.len() { "param" } else { "local" };
                        format!("{{\"name\":{},\"role\":\"{role}\",\"v\":{}}}", js(&n), value_json(v))
                    })
                    .collect();
                format!(
                    "{{\"func\":{},\"name\":{},\"pc\":{},\"stackBase\":{},\"locals\":[{}]}}",
                    f.func_index(),
                    js(&self.func_name(f.func_index())),
                    f.pc,
                    f.stack_base,
                    locals.join(",")
                )
            })
            .collect();
        let labels: Vec<String> = t.labels.iter().map(|l| format!("{{\"loop\":{},\"height\":{},\"arity\":{}}}", l.is_loop, l.height, l.arity)).collect();
        let inst = self.inst.as_ref().unwrap();
        let globals: Vec<String> = inst
            .globals
            .iter()
            .map(|&g| {
                let gi = &store.globals[g as usize];
                format!("{{\"mutable\":{},\"v\":{}}}", gi.ty.mutable, value_json(&gi.value))
            })
            .collect();
        let memory = match inst.memories.first() {
            Some(&m) => {
                let mem = &store.memories[m as usize];
                let last = match t.last_mem {
                    Some((addr, len, write)) => format!("{{\"addr\":{addr},\"len\":{len},\"write\":{write}}}"),
                    None => "null".into(),
                };
                format!("{{\"pages\":{},\"bytes\":{},\"last\":{last}}}", mem.pages(), mem.data.len())
            }
            None => "null".into(),
        };
        let at = match t.frames.last() {
            Some(f) => format!("{{\"func\":{},\"pc\":{}}}", f.func_index(), f.pc),
            None => "null".into(),
        };
        let output: Vec<String> = store.output.iter().map(|o| js(o)).collect();
        format!(
            "{{\"status\":\"{status}\",\"finalStatus\":\"{final_status}\",\"step\":{},\"total\":{total},\"trap\":{},\"results\":[{}],\"at\":{at},\"stack\":[{}],\"frames\":[{}],\"labels\":[{}],\"globals\":[{}],\"memory\":{memory},\"output\":[{}]}}",
            t.steps,
            trap.map(|x| js(&x.0)).unwrap_or_else(|| "null".into()),
            results.iter().map(value_json).collect::<Vec<_>>().join(","),
            stack.join(","),
            frames.join(","),
            labels.join(","),
            globals.join(","),
            output.join(",")
        )
    }

    /// Bytes of linear memory from the last run (empty when out of range or no memory).
    pub fn read_memory(&self, offset: usize, len: usize) -> Vec<u8> {
        let Some(&m) = self.inst.as_ref().and_then(|i| i.memories.first()) else { return vec![] };
        let data = &self.runner.store.memories[m as usize].data;
        let start = offset.min(data.len());
        let end = offset.saturating_add(len).min(data.len());
        data[start..end].to_vec()
    }
}

impl crate::runtime::Frame {
    /// This frame's function, in the module's function index space.
    pub fn func_index(&self) -> u32 {
        self.code_index
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAC: &str = r#"(module
  (memory 1)
  (func $fac (export "fac") (param $n i64) (result i64)
    (if (result i64) (i64.eqz (local.get $n))
      (then (i64.const 1))
      (else (i64.mul (local.get $n) (call $fac (i64.sub (local.get $n) (i64.const 1)))))))
  (func (export "poke") (param $a i32) (i32.store (local.get $a) (i32.const 0x01020304))))"#;

    #[test]
    fn runs_to_the_end_and_reports_results() {
        let mut s = Session::load_text(FAC).unwrap();
        let state = s.run("fac", &["5".into()], None).unwrap();
        assert!(state.contains("\"status\":\"finished\""), "{state}");
        assert!(state.contains("\"results\":[{\"type\":\"i64\",\"value\":\"120\""), "{state}");
        assert!(s.describe().contains("\"name\":\"$fac\""));
    }

    #[test]
    fn stops_after_any_step_with_frames_and_locals() {
        let mut s = Session::load_text(FAC).unwrap();
        let full = s.run("fac", &["3".into()], None).unwrap();
        let total: u64 = full.split("\"total\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap();
        assert!(total > 20);
        let mid = s.run("fac", &["3".into()], Some(total / 2)).unwrap();
        assert!(mid.contains("\"status\":\"paused\""));
        assert!(mid.contains("\"name\":\"$n\",\"role\":\"param\""));
        assert!(mid.matches("\"name\":\"$fac\"").count() >= 2, "recursion shows several frames: {mid}");
    }

    #[test]
    fn traps_are_reported_and_memory_is_readable() {
        let mut s = Session::load_text(FAC).unwrap();
        let ok = s.run("poke", &["8".into()], None).unwrap();
        assert!(ok.contains("\"status\":\"finished\""));
        assert_eq!(s.read_memory(8, 4), vec![4, 3, 2, 1]);
        let bad = s.run("poke", &["65535".into()], None).unwrap();
        assert!(bad.contains("\"trap\":\"out of bounds memory access\""), "{bad}");
        assert!(bad.contains("\"write\":true"));
        assert!(s.run("fac", &["x".into()], None).is_err());
        assert!(Session::load_text("(module (func (result i32) (i64.const 1)))").err().unwrap().contains("type mismatch"));
    }
}
