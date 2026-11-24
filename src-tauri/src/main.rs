#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};

        if std::io::stdout().as_raw_handle().is_null() {
            // Keep terminal output (including --dump) without allocating a console on GUI launch.
            unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
        }
    }
    agent_tally_lib::run()
}
