//! The `c` host module: what C programs compiled by Small C import. Everything
//! else (printf, malloc, strings, maths) is the C library inside the module.
//!
//! | import | type | what it does |
//! | --- | --- | --- |
//! | `write` | (i32 fd, i32 ptr, i32 len) -> i32 | writes bytes to stdout (1) or stderr (2), returns len |
//! | `exit` | (i32 code) | ends the program with an exit status |
//!
//! Small C's JavaScript host (`packages/small-c/src/lang/compile.ts`) implements
//! the same two.

use std::collections::HashMap;
use std::rc::Rc;

use crate::module::*;
use crate::runtime::{ExternVal, Store, Trap};
use crate::spec::Runner;

pub const MODULE: &str = "c";
/// The trap message `exit` stops the machine with; `Store::exit_code` says it was an exit.
pub const EXIT_TRAP: &str = "exit";

/// Appends program output: complete lines go to `output`, the rest waits in `pending`.
pub fn write_bytes(store: &mut Store, bytes: &[u8]) {
    for &b in bytes {
        if b == b'\n' {
            let line = String::from_utf8_lossy(&store.pending).into_owned();
            store.output.push(line);
            store.pending.clear();
        } else {
            store.pending.push(b);
        }
    }
}

/// Registers the `c` host if `module` imports from it. The program's memory is
/// its own export, so the host finds it after instantiation (memory index 0).
pub fn install(runner: &mut Runner, module: &Module) {
    if !module.imports.iter().any(|i| i.module == MODULE) {
        return;
    }
    let store = &mut runner.store;
    let mut exports = HashMap::new();
    use ValType::*;
    let write = store.add_host_func(
        "c.write",
        FuncType {
            params: vec![I32, I32, I32],
            results: vec![I32],
        },
        Rc::new(|s: &mut Store, a: &[Value]| {
            let (Value::I32(fd), Value::I32(p), Value::I32(l)) = (a[0], a[1], a[2]) else {
                unreachable!()
            };
            // The module's own memory: the last one created (host memories come first).
            let mem = s
                .memories
                .len()
                .checked_sub(1)
                .ok_or_else(|| Trap::new("the program has no memory"))?;
            let (p, n) = (p as u32 as usize, l as u32 as usize);
            let bytes = s.memories[mem]
                .data
                .get(p..p.saturating_add(n))
                .ok_or_else(|| Trap::new("out of bounds memory access"))?
                .to_vec();
            if fd == 1 || fd == 2 {
                write_bytes(s, &bytes);
            }
            Ok(vec![Value::I32(l)])
        }),
    );
    exports.insert("write".to_string(), ExternVal::Func(write));
    let exit = store.add_host_func(
        "c.exit",
        FuncType {
            params: vec![I32],
            results: vec![],
        },
        Rc::new(|s: &mut Store, a: &[Value]| {
            let Value::I32(code) = a[0] else {
                unreachable!()
            };
            s.exit_code = Some(code);
            Err(Trap::new(EXIT_TRAP))
        }),
    );
    exports.insert("exit".to_string(), ExternVal::Func(exit));
    runner.register_host(MODULE, exports);
}

#[cfg(test)]
mod tests {
    use crate::debug::Session;

    const PROGRAM: &str = r#"(module
      (import "c" "write" (func $write (param i32 i32 i32) (result i32)))
      (import "c" "exit" (func $exit (param i32)))
      (memory (export "memory") 1)
      (data (i32.const 16) "hi\nthere")
      (func (export "_start")
        (drop (call $write (i32.const 1) (i32.const 16) (i32.const 8)))
        (call $exit (i32.const 3))
        unreachable))"#;

    #[test]
    fn write_and_exit() {
        let mut s = Session::load_text(PROGRAM).unwrap();
        let r = s.run_to_end("_start", 1000).unwrap();
        assert_eq!(r.output, "hi\nthere");
        assert_eq!(r.exit, Some(3));
        assert_eq!(r.trap, None);
        // The debugger reports the exit as its own status, with the unfinished line.
        let state = s.run("_start", &[], None).unwrap();
        assert!(state.contains("\"exit\":3"), "{state}");
        assert!(state.contains("\"status\":\"exited\""), "{state}");
        assert!(state.contains("\"output\":[\"hi\",\"there\"]"), "{state}");
    }
}
