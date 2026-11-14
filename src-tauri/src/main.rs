// Prevents an extra console window on Windows in release builds. Debug keeps the console
// because the core writes real diagnostics to it (engine argv, ports, timings).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nexus_ai_lib::run()
}
