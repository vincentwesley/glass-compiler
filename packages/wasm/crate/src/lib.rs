//! Glass Wasm: a WebAssembly 1.0 virtual machine written from scratch to be
//! looked through. Text and binary front ends, a validator, and an interpreter
//! whose every step can be inspected.

pub mod binary;
pub mod c_host;
pub mod debug;
pub mod disasm;
pub mod exec;
pub mod float;
pub mod jsnum;
pub mod json;
pub mod module;
pub mod opcodes;
pub mod pane_host;
pub mod runtime;
pub mod spec;
pub mod text;
pub mod validate;

#[cfg(target_arch = "wasm32")]
pub mod web;
