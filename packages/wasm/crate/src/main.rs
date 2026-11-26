//! `glass-wasm spec <file.wast|dir>… [--json]`: runs WebAssembly spec scripts
//! and reports passes per file. With `--json`, prints the results.json the hub shows.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use glass_wasm::json;
use glass_wasm::spec::{FileResult, Runner};

fn wast_files(p: &Path) -> Vec<PathBuf> {
    if p.is_dir() {
        let mut v: Vec<PathBuf> = std::fs::read_dir(p)
            .expect("readable directory")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "wast"))
            .collect();
        v.sort();
        v
    } else {
        vec![p.to_path_buf()]
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json_out = args.iter().any(|a| a == "--json");
    let verbose = args.iter().any(|a| a == "-v" || a == "--verbose");
    let paths: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
    if paths.first().map(|s| s.as_str()) != Some("spec") || paths.len() < 2 {
        eprintln!("usage: glass-wasm spec <file.wast|dir>... [--json] [-v]");
        return ExitCode::from(2);
    }
    let mut results: Vec<(String, FileResult)> = Vec::new();
    for p in &paths[1..] {
        for f in wast_files(Path::new(p)) {
            let src = match std::fs::read_to_string(&f) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("{}: {e}", f.display());
                    return ExitCode::from(2);
                }
            };
            // Each script gets a fresh runner, as in the reference interpreter.
            let r = Runner::new().run_script(&src);
            let name = f.file_name().unwrap().to_string_lossy().into_owned();
            if !json_out {
                println!(
                    "{:<32} {:>5} / {:<5} {}",
                    name,
                    r.passed,
                    r.total(),
                    if r.failed == 0 { "ok" } else { "FAIL" }
                );
                if verbose {
                    for x in r.failures.iter().take(20) {
                        println!("    line {:>5} {}: {}", x.line, x.command, x.message);
                    }
                }
            }
            results.push((name, r));
        }
    }
    let passed: usize = results.iter().map(|r| r.1.passed).sum();
    let total: usize = results.iter().map(|r| r.1.total()).sum();
    let clean = results.iter().filter(|r| r.1.failed == 0).count();
    if json_out {
        let files: Vec<String> = results
            .iter()
            .map(|(n, r)| {
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
                format!(
                    "{{\"file\":{},\"passed\":{},\"failed\":{},\"failures\":[{}]}}",
                    json::string(n),
                    r.passed,
                    r.failed,
                    fails.join(",")
                )
            })
            .collect();
        println!(
            "{{\"passed\":{passed},\"total\":{total},\"files\":[{}]}}",
            files.join(",")
        );
    } else {
        println!(
            "\n{passed} / {total} commands pass; {clean} / {} files fully pass",
            results.len()
        );
    }
    // With --json the numbers are the output, failures included; the exit status is for humans and CI.
    if json_out || passed == total {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
