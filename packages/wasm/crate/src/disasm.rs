//! Renders instructions as text-format lines for the debugger's code panel,
//! with their nesting depth.

use crate::float::{fmt_f32, fmt_f64};
use crate::module::*;
use crate::opcodes::{instr_name, mem_op};

pub struct Line {
    pub depth: usize,
    pub text: String,
}

fn block_suffix(ty: &BlockType) -> String {
    match ty {
        BlockType::Empty => String::new(),
        BlockType::Value(t) => format!(" (result {t})"),
    }
}

/// Text for one instruction, using names from `func` for locals where it has them.
pub fn instr_text(m: &Module, func: &Func, i: &Instr) -> String {
    use Instr::*;
    let name = instr_name(i);
    let local = |x: u32| match func.local_names.get(x as usize).and_then(|n| n.as_deref()) {
        Some(n) => format!("${n}"),
        None => x.to_string(),
    };
    let fname = |x: u32| {
        let imported = m.imported(ExternKind::Func) as u32;
        match x
            .checked_sub(imported)
            .and_then(|i| m.funcs.get(i as usize))
            .and_then(|f| f.name.as_deref())
        {
            Some(n) => format!("${n}"),
            None => x.to_string(),
        }
    };
    match i {
        Block { ty, .. } | Loop { ty, .. } | If { ty, .. } => format!("{name}{}", block_suffix(ty)),
        Br(l) | BrIf(l) => format!("{name} {l}"),
        BrTable(ls, d) => format!(
            "{name} {} {d}",
            ls.iter()
                .map(|l| l.to_string())
                .collect::<Vec<_>>()
                .join(" ")
        ),
        Call(f) => format!("{name} {}", fname(*f)),
        CallIndirect(t) => format!("{name} (type {t})"),
        LocalGet(x) | LocalSet(x) | LocalTee(x) => format!("{name} {}", local(*x)),
        GlobalGet(x) | GlobalSet(x) => format!("{name} {x}"),
        Load(op, a) | Store(op, a) => {
            let natural = mem_op(*op).unwrap().bytes.trailing_zeros();
            let mut s = name.to_string();
            if a.offset != 0 {
                s += &format!(" offset={}", a.offset);
            }
            if a.align != natural {
                s += &format!(" align={}", 1u64 << a.align);
            }
            s
        }
        I32Const(v) => format!("{name} {v}"),
        I64Const(v) => format!("{name} {v}"),
        F32Const(b) => format!("{name} {}", fmt_f32(*b)),
        F64Const(b) => format!("{name} {}", fmt_f64(*b)),
        _ => name.to_string(),
    }
}

/// One line per instruction (the closing `end` of the function included), indented by block depth.
pub fn func_lines(m: &Module, func: &Func) -> Vec<Line> {
    let mut depth = 0usize;
    let mut out = Vec::with_capacity(func.body.len());
    for (pc, i) in func.body.iter().enumerate() {
        let is_last = pc + 1 == func.body.len();
        let d = match i {
            Instr::End if !is_last => {
                depth = depth.saturating_sub(1);
                depth
            }
            Instr::Else { .. } => depth.saturating_sub(1),
            _ => depth,
        };
        out.push(Line {
            depth: if is_last { 0 } else { d },
            text: instr_text(m, func, i),
        });
        if matches!(
            i,
            Instr::Block { .. } | Instr::Loop { .. } | Instr::If { .. }
        ) {
            depth += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::parse_module_text;

    #[test]
    fn indents_blocks_and_names_locals() {
        let m = parse_module_text(
            "(module (func $f (param $n i32) (result i32) (block (result i32) (local.get $n))))",
        )
        .unwrap();
        let lines = func_lines(&m, &m.funcs[0]);
        let text: Vec<String> = lines
            .iter()
            .map(|l| format!("{}{}", "  ".repeat(l.depth), l.text))
            .collect();
        assert_eq!(
            text,
            vec!["block (result i32)", "  local.get $n", "end", "end"]
        );
    }
}
