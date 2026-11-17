# NEXUS AI — v0.1.0 release notes

**Release:** 0.1.0 · **Tag:** `v0.1.0` · **Date:** 2026-11-17
**Platform:** Windows 10 1803+ / 11, x64.

> ## What this release is
>
> The first installable build: an unsigned NSIS setup that installs the app and the pinned
> llama.cpp CPU engine, then downloads the model that fits the machine on first launch.
> There is **no code signing**, **no notarization** and **no updater**. Windows SmartScreen
> will warn on first run; verify the file against `SHA256SUMS.txt` before running it.

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `NEXUS AI_0.1.0_x64-setup.exe` | 15.39 MiB | `125563cb93a1c6edaf9d186f1b72d2d594e69d69d14b21ffdcad3bd983c95ce4` |

## Install and first run

1. Run the setup. It installs per user into `%LOCALAPPDATA%\NEXUS AI` — no admin prompt — and
   ships `engine\llama-server.exe` (build 12189, CPU x64) beside the app.
2. The welcome screen reads this machine (RAM, physical cores, free disk, models folder) and
   recommends one file by RAM: **Llama 3.2 1B Instruct** below 16 GiB, **3B** at 16 GiB or more.
   Both are Q4_K_M and come from huggingface.co.
3. Tick the licence, press Download. The transfer goes through Windows' own `curl.exe`, resumes
   from a partial file after a failure, and only becomes a model after its SHA-256 matches the
   pinned value. Cancel deletes the partial file.
4. The first run needs internet and a few hours at the measured 66–114 kB/s (808 MB / 2.02 GB).
   After that the app makes no network calls.
5. Uninstall removes the program and the engine and leaves the weights in
   `%LOCALAPPDATA%\NexusAI\models` and the database in `%APPDATA%\NexusAI` alone.

Full instructions: `docs/INSTALL.md`.

## What is verified in this release

Recorded in `TEST_RESULTS.md` → "2026-11-17 — M6 packaging", numbers in `MEASUREMENTS.md` §16:

- `cargo test` 69 + 7 + 5 + 6 green; `cargo clippy --workspace --all-targets -D warnings` clean;
  `tsc --noEmit` and `vite build` exit 0.
- `npm run tauri build` → 15.39 MiB setup; `tools/stage-engine.mjs` staged 24 files (44.7 MiB)
  and the copy answers `--version` with build 12189.
- `tools/m6-gate.mjs`, against the installed binary: silent install exit 0; engine found at
  `<install>\engine`; first-run screen with 19.9 GB RAM / 4 cores / 71.94 GB free; recommendation
  `llama-3.2-3b-instruct-q4-k-m`; licence tick enables the button; download writes a growing
  `.part` (66–114 kB/s); Cancel leaves no `.part`; a real answer `ready` streams from the
  installed engine (`<install>\engine\llama-server.exe`, port 55020, 4 threads); uninstall exit 0
  with models and data folders preserved. 18 PASS, 1 SKIP.

## What is not verified, and why

The **first-run download has not been carried to completion on record**. At 66–114 kB/s the 2.02 GB
file needs 5–9 hours; the gate watched 120 s and records the SHA-256 verification step as skipped,
not passed. The comparison and rename logic have unit tests, but no completed download exists in
the evidence set yet.

Also open: the installer is unsigned (KI-23), the engine is CPU-only (KI-25), and there is no
updater (TD-26). Earlier milestones (M1 answer, M2 SQLite, M3 knowledge, M4 tools/approvals) keep
their own tagged gate records.

## Upgrading from an M1 source checkout

Nothing to migrate: the app reads the same `NEXUS_MODELS_DIR` / `NEXUS_DATA_DIR`, and the database
schema version is unchanged by this milestone. If `D:\NEXUS-MODELS` exists it is still preferred
over `%LOCALAPPDATA%\NexusAI\models`, which is why an owner's existing 3B file is used without a
download.
