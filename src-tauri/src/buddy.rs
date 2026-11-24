//! An always-on-top compact status window follows the dashboard's minimize/restore lifecycle.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, Window, WindowEvent};

pub const LABEL: &str = "buddy";
/// Gap between the compact window and the screen edges, in logical pixels.
const MARGIN: f64 = 16.0;

static SHOWN: AtomicBool = AtomicBool::new(false);
static PLACED: AtomicBool = AtomicBool::new(false);

pub fn on_main_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match event {
        WindowEvent::Resized(_) | WindowEvent::Focused(_) => {
            if let Ok(minimized) = window.is_minimized() {
                set_visible(window.app_handle(), minimized);
            }
        }
        // The hidden compact window would otherwise keep the app running.
        WindowEvent::Destroyed => window.app_handle().exit(0),
        _ => {}
    }
}

fn set_visible<R: Runtime>(app: &AppHandle<R>, show: bool) {
    if SHOWN.load(Ordering::SeqCst) == show {
        return;
    }
    let Some(buddy) = app.get_webview_window(LABEL) else {
        return;
    };
    let result = if show {
        if !PLACED.load(Ordering::SeqCst) || buddy.current_monitor().ok().flatten().is_none() {
            PLACED.store(place(app, &buddy).is_some(), Ordering::SeqCst);
        }
        buddy.show()
    } else {
        buddy.hide()
    };
    if result.is_ok() {
        SHOWN.store(show, Ordering::SeqCst);
        let _ = app.emit_to(LABEL, "buddy-visible", show);
    }
}

/// Bottom-right corner of the work area (above the taskbar) of the main window's monitor.
fn place<R: Runtime>(app: &AppHandle<R>, buddy: &tauri::WebviewWindow<R>) -> Option<()> {
    let main = app.get_webview_window("main");
    let monitor = main
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| buddy.primary_monitor().ok().flatten())?;
    let size = buddy
        .outer_size()
        .ok()?
        .to_logical::<f64>(buddy.scale_factor().ok()?);
    let size = size.to_physical::<i32>(monitor.scale_factor());
    let area = monitor.work_area();
    let margin = (MARGIN * monitor.scale_factor()) as i32;
    let x = area.position.x + (area.size.width as i32 - size.width - margin).max(0);
    let y = area.position.y + (area.size.height as i32 - size.height - margin).max(0);
    buddy.set_position(PhysicalPosition::new(x, y)).ok()
}

#[tauri::command]
pub fn show_main<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Dashboard unavailable")?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    set_visible(&app, false);
    Ok(())
}
