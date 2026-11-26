//! The `pane` host module: the small runtime service Pane programs compiled to
//! WebAssembly by Glass Compiler import. Everything else (values, arithmetic,
//! strings, type checks, error messages) is inside the compiled module itself.
//!
//! | import | type | what it does |
//! | --- | --- | --- |
//! | `memory` | memory | the program's linear memory, owned by the host |
//! | `print` | (i32 ptr, i32 len) | prints one line of UTF-8 text |
//! | `error` | (i32 ptr, i32 len) | stops the program with a runtime error |
//! | `format_number` | (f64, i32 dst) -> i32 | writes how Pane prints the number, returns its length |
//! | `rem` | (f64, f64) -> f64 | the exact floating-point remainder (JavaScript's `%`) |
//!
//! Glass Compiler's own JavaScript host (`packages/compiler/src/lang/wasm/host.ts`)
//! implements the same five, and the tests check both against its bytecode VM.

use std::collections::HashMap;
use std::rc::Rc;

use crate::module::*;
use crate::runtime::{ExternVal, HostFn, Store, Trap};
use crate::spec::Runner;

pub const MODULE: &str = "pane";
/// The longest text `format_number` writes ("-1.23456789012e-308" is 19 bytes).
pub const NUMBER_TEXT_MAX: usize = 32;

fn text(store: &Store, mem: u32, ptr: i32, len: i32) -> Result<String, Trap> {
    let data = &store.memories[mem as usize].data;
    let (p, l) = (ptr as u32 as usize, len as u32 as usize);
    let bytes = data
        .get(p..p.saturating_add(l))
        .ok_or_else(|| Trap::new("out of bounds memory access"))?;
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

/// Registers the `pane` host for `module` if it imports from it, creating the
/// memory it asks for.
pub fn install(runner: &mut Runner, module: &Module) -> Result<(), String> {
    let wanted = module.imports.iter().filter(|i| i.module == MODULE);
    let mut limits = None;
    for imp in wanted {
        if let (ImportDesc::Memory(l), "memory") = (&imp.desc, imp.name.as_str()) {
            limits = Some(*l);
        }
    }
    if !module.imports.iter().any(|i| i.module == MODULE) {
        return Ok(());
    }
    let store = &mut runner.store;
    let mem = store
        .add_memory(limits.unwrap_or(Limits { min: 1, max: None }))
        .map_err(|t| t.0)?;
    let mut exports = HashMap::new();
    exports.insert("memory".to_string(), ExternVal::Memory(mem));
    let mut func = |name: &str, params: Vec<ValType>, results: Vec<ValType>, f: HostFn| {
        let a = store.add_host_func(&format!("{MODULE}.{name}"), FuncType { params, results }, f);
        exports.insert(name.to_string(), ExternVal::Func(a));
    };
    use ValType::*;
    func(
        "print",
        vec![I32, I32],
        vec![],
        Rc::new(move |s: &mut Store, a: &[Value]| {
            let (Value::I32(p), Value::I32(l)) = (a[0], a[1]) else {
                unreachable!()
            };
            let line = text(s, mem, p, l)?;
            s.output.push(line);
            Ok(vec![])
        }),
    );
    func(
        "error",
        vec![I32, I32],
        vec![],
        Rc::new(move |s: &mut Store, a: &[Value]| {
            let (Value::I32(p), Value::I32(l)) = (a[0], a[1]) else {
                unreachable!()
            };
            Err(Trap(text(s, mem, p, l)?))
        }),
    );
    func(
        "format_number",
        vec![F64, I32],
        vec![I32],
        Rc::new(move |s: &mut Store, a: &[Value]| {
            let (Value::F64(bits), Value::I32(dst)) = (a[0], a[1]) else {
                unreachable!()
            };
            let t = crate::jsnum::pane_format(f64::from_bits(bits));
            let data = &mut s.memories[mem as usize].data;
            let d = dst as u32 as usize;
            let out = data
                .get_mut(d..d + t.len())
                .ok_or_else(|| Trap::new("out of bounds memory access"))?;
            out.copy_from_slice(t.as_bytes());
            Ok(vec![Value::I32(t.len() as i32)])
        }),
    );
    func(
        "rem",
        vec![F64, F64],
        vec![F64],
        Rc::new(|_: &mut Store, a: &[Value]| {
            let (Value::F64(x), Value::F64(y)) = (a[0], a[1]) else {
                unreachable!()
            };
            // Rust's `%` on floats is the exact fmod, like JavaScript's.
            Ok(vec![Value::F64(
                (f64::from_bits(x) % f64::from_bits(y)).to_bits(),
            )])
        }),
    );
    runner.register_host(MODULE, exports);
    Ok(())
}
