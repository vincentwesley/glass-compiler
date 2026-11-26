//! The WebAssembly text format: lexer and module parser.
pub mod lexer;
pub mod parser;

pub use parser::{parse_module_text, ParseError};
