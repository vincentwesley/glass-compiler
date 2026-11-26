//! The browser API: plain C-ABI functions over linear memory (no bindgen).
//! Strings go in as UTF-8 at a pointer the page got from `gw_alloc`; results
//! come back in one output buffer read through `gw_out_ptr`/`gw_out_len`.

use std::cell::RefCell;

use crate::debug::Session;
use crate::json;
use crate::spec::Runner;

thread_local! {
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

fn set_out(bytes: Vec<u8>) -> usize {
    let n = bytes.len();
    OUT.with(|o| *o.borrow_mut() = bytes);
    n
}

unsafe fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        return &[];
    }
    // SAFETY: the page wrote `len` bytes at `ptr`, which it got from gw_alloc.
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

#[no_mangle]
pub extern "C" fn gw_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` and `len` must come from one `gw_alloc` call.
#[no_mangle]
pub unsafe extern "C" fn gw_free(ptr: *mut u8, len: usize) {
    // SAFETY: rebuilds the Vec gw_alloc leaked, with its original capacity.
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(1))) };
}

#[no_mangle]
pub extern "C" fn gw_out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn gw_out_len() -> usize {
    OUT.with(|o| o.borrow().len())
}

/// Runs one `.wast` script. Output: `{"passed":n,"failed":n,"failures":[…]}`.
///
/// # Safety
/// `ptr`/`len` must describe bytes written by the page.
#[no_mangle]
pub unsafe extern "C" fn gw_run_spec(ptr: *const u8, len: usize) -> usize {
    let src = String::from_utf8_lossy(unsafe { input(ptr, len) });
    let r = Runner::new().run_script(&src);
    let fails: Vec<String> = r
        .failures
        .iter()
        .map(|f| {
            format!(
                "{{\"line\":{},\"command\":{},\"message\":{}}}",
                f.line,
                json::string(&f.command),
                json::string(&f.message)
            )
        })
        .collect();
    set_out(
        format!(
            "{{\"passed\":{},\"failed\":{},\"failures\":[{}]}}",
            r.passed,
            r.failed,
            fails.join(",")
        )
        .into_bytes(),
    )
}

/// Loads a module for debugging: text (`binary == 0`) or binary. Returns 0 and the
/// module description, or 1 and an error message.
///
/// # Safety
/// `ptr`/`len` must describe bytes written by the page.
#[no_mangle]
pub unsafe extern "C" fn gw_load(ptr: *const u8, len: usize, binary: u32) -> u32 {
    let bytes = unsafe { input(ptr, len) };
    let session = if binary != 0 {
        Session::load_binary(bytes)
    } else {
        Session::load_text(&String::from_utf8_lossy(bytes))
    };
    match session {
        Ok(s) => {
            set_out(s.describe().into_bytes());
            SESSION.with(|x| *x.borrow_mut() = Some(s));
            0
        }
        Err(e) => {
            set_out(e.into_bytes());
            SESSION.with(|x| *x.borrow_mut() = None);
            1
        }
    }
}

/// Runs an export of the loaded module. Input: the export name's length in bytes,
/// `:`, the name, then one argument per line (names may contain anything, even newlines). Stops after `stop_at` steps (negative: run to the end). Returns 0 and the
/// machine state, or 1 and an error message.
///
/// # Safety
/// `ptr`/`len` must describe bytes written by the page.
#[no_mangle]
pub unsafe extern "C" fn gw_run(ptr: *const u8, len: usize, stop_at: f64) -> u32 {
    let bytes = unsafe { input(ptr, len) };
    let (name, args) = match split_call(bytes) {
        Some(x) => x,
        None => {
            set_out(b"malformed call".to_vec());
            return 1;
        }
    };
    let stop = if stop_at < 0.0 {
        None
    } else {
        Some(stop_at as u64)
    };
    let r = SESSION.with(|x| match x.borrow_mut().as_mut() {
        Some(s) => s.run(&name, &args, stop),
        None => Err("no module loaded".into()),
    });
    match r {
        Ok(state) => {
            set_out(state.into_bytes());
            0
        }
        Err(e) => {
            set_out(e.into_bytes());
            1
        }
    }
}

/// `<name length>:<name><arg>\n<arg>…` to the name and its arguments.
fn split_call(bytes: &[u8]) -> Option<(String, Vec<String>)> {
    let colon = bytes.iter().position(|&b| b == b':')?;
    let n: usize = std::str::from_utf8(&bytes[..colon]).ok()?.parse().ok()?;
    let rest = bytes.get(colon + 1..)?;
    let name = String::from_utf8(rest.get(..n)?.to_vec()).ok()?;
    let tail = String::from_utf8_lossy(&rest[n..]);
    let args = if tail.is_empty() {
        vec![]
    } else {
        tail.split('\n').map(String::from).collect()
    };
    Some((name, args))
}

/// The last full run's trace: (function index, pc) per step as little-endian u32 pairs.
#[no_mangle]
pub extern "C" fn gw_trace() -> usize {
    let bytes = SESSION.with(|x| {
        x.borrow()
            .as_ref()
            .map(|s| {
                s.trace
                    .iter()
                    .flat_map(|(f, pc)| f.to_le_bytes().into_iter().chain(pc.to_le_bytes()))
                    .collect()
            })
            .unwrap_or_default()
    });
    set_out(bytes)
}

/// Copies `len` bytes of linear memory from `offset` (as left by the last run) to the output.
#[no_mangle]
pub extern "C" fn gw_memory(offset: u32, len: u32) -> usize {
    let bytes = SESSION.with(|x| {
        x.borrow()
            .as_ref()
            .map(|s| s.read_memory(offset as usize, len as usize))
            .unwrap_or_default()
    });
    set_out(bytes)
}

/// How Pane prints the number `x` (for the differential tests against JavaScript).
#[no_mangle]
pub extern "C" fn gw_format_number(x: f64) -> usize {
    set_out(crate::jsnum::pane_format(x).into_bytes())
}

/// Loads a binary module and runs `_start` to the end (no trace), up to `max_steps`.
/// Output: `{"output":"…","exit":n|null,"trap":"…"|null,"steps":n}`, or 1 and an error.
///
/// # Safety
/// `ptr`/`len` must describe bytes written by the page.
#[no_mangle]
pub unsafe extern "C" fn gw_run_program(ptr: *const u8, len: usize, max_steps: f64) -> u32 {
    let bytes = unsafe { input(ptr, len) };
    let r = Session::load_binary(bytes).and_then(|mut s| s.run_to_end("_start", max_steps as u64));
    match r {
        Ok(p) => {
            set_out(
                format!(
                    "{{\"output\":{},\"exit\":{},\"trap\":{},\"steps\":{}}}",
                    json::string(&p.output),
                    p.exit
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "null".into()),
                    p.trap
                        .map(|t| json::string(&t))
                        .unwrap_or_else(|| "null".into()),
                    p.steps
                )
                .into_bytes(),
            );
            0
        }
        Err(e) => {
            set_out(e.into_bytes());
            1
        }
    }
}
