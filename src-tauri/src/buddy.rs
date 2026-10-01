//! Desktop buddy: while the main window is minimized, one robot stands on the desktop in a
//! small borderless, transparent, always-on-top window and keeps acting out what its agent does.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, Window, WindowEvent};

pub const LABEL: &str = "buddy";
/// Gap between the buddy and the screen edges, in logical pixels.
const MARGIN: f64 = 16.0;

static SHOWN: AtomicBool = AtomicBool::new(false);
static PLACED: AtomicBool = AtomicBool::new(false);

/// Follows the main window: minimizing it brings the buddy out, restoring it sends it back.
pub fn on_main_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match event {
        // Minimizing and restoring both arrive as resizes on Windows and Linux.
        WindowEvent::Resized(_) => set_visible(window.app_handle(), window.is_minimized().unwrap_or(false)),
        // The hidden buddy window would otherwise keep the app alive without any visible window.
        WindowEvent::Destroyed => window.app_handle().exit(0),
        _ => {}
    }
}

fn set_visible<R: Runtime>(app: &AppHandle<R>, show: bool) {
    if SHOWN.swap(show, Ordering::SeqCst) == show {
        return;
    }
    let Some(buddy) = app.get_webview_window(LABEL) else { return };
    if show {
        if !PLACED.swap(true, Ordering::SeqCst) {
            place(app, &buddy);
        }
        let _ = buddy.show();
        let _ = buddy.set_always_on_top(true);
    } else {
        let _ = buddy.hide();
    }
    let _ = app.emit_to(LABEL, "buddy-visible", show);
}

/// Bottom-right corner of the work area (above the taskbar) of the main window's monitor.
fn place<R: Runtime>(app: &AppHandle<R>, buddy: &tauri::WebviewWindow<R>) {
    let main = app.get_webview_window("main");
    let monitor = main
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| buddy.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, buddy.outer_size()) else { return };
    let area = monitor.work_area();
    let margin = (MARGIN * monitor.scale_factor()) as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32;
    let _ = buddy.set_position(PhysicalPosition::new(x, y));
}

/// Double-clicking the buddy brings the main window back (which hides the buddy again).
#[tauri::command]
pub fn show_main<R: Runtime>(app: AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}
