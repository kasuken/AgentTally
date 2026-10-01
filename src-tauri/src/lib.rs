mod buddy;
mod model;
mod providers;
mod scanner;
mod util;

use model::Snapshot;
use scanner::Scanner;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

const POLL: Duration = Duration::from_millis(1200);
/// Re-walk the provider folders every N polls to pick up new sessions.
const DISCOVER_EVERY: u32 = 5;

#[derive(Default)]
struct Latest(Arc<Mutex<Option<Snapshot>>>);

#[tauri::command]
fn snapshot(latest: State<'_, Latest>) -> Option<Snapshot> {
    latest.0.lock().ok().and_then(|g| g.clone())
}

/// Scans once and returns the snapshot; used by `--dump` for debugging.
pub fn scan_once() -> Snapshot {
    let mut scanner = Scanner::new();
    scanner.discover();
    scanner.poll();
    scanner.snapshot()
}

pub fn run() {
    if std::env::args().any(|a| a == "--dump") {
        let snap = scan_once();
        println!("{}", serde_json::to_string_pretty(&snap).unwrap_or_default());
        return;
    }
    tauri::Builder::default()
        .manage(Latest::default())
        .invoke_handler(tauri::generate_handler![snapshot, buddy::show_main])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                buddy::on_main_event(window, event);
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let latest = app.state::<Latest>().0.clone();
            std::thread::spawn(move || {
                let mut scanner = Scanner::new();
                let mut tick = 0u32;
                loop {
                    if tick % DISCOVER_EVERY == 0 {
                        scanner.discover();
                    }
                    scanner.poll();
                    let snap = scanner.snapshot();
                    let _ = handle.emit("tally", &snap);
                    if let Ok(mut g) = latest.lock() {
                        *g = Some(snap);
                    }
                    tick = tick.wrapping_add(1);
                    std::thread::sleep(POLL);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AgentTally");
}
