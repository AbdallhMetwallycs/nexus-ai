# Installing NEXUS AI (v0.1.0)

One file, no administrator rights, no account.

## What you download

| File | Size | Signed? |
| --- | --- | --- |
| `NEXUS-AI_0.1.0_x64-setup.exe` | 15.39 MiB | No |
| `SHA256SUMS.txt` | ~100 B | — |

GitHub does not keep spaces in release asset names, so the asset was renamed to
`NEXUS-AI_0.1.0_x64-setup.exe` for the release while `tauri build` names the local artifact
`NEXUS AI_0.1.0_x64-setup.exe`. It is the same 16,139,699-byte file; the commands below use the
published name. The setup file contains the app, the React UI and the pinned llama.cpp CPU engine
(build 12189).
**It does not contain a language model.** That is downloaded on first launch, after you accept its
licence, and verified before it is used.

## Before you run it

The file is not code-signed yet (KI-23). Windows SmartScreen will say "Windows protected your PC".
Expected path: **More info → Run anyway**.

To check the download was not altered, in PowerShell in the folder you saved both files:

```powershell
Get-FileHash 'NEXUS-AI_0.1.0_x64-setup.exe' -Algorithm SHA256
Get-Content SHA256SUMS.txt
```

The two hashes must be identical. For v0.1.0 the setup hash is:

```
125563cb93a1c6edaf9d186f1b72d2d594e69d69d14b21ffdcad3bd983c95ce4
```

## Requirements

- Windows 10 1803 or newer, x64 (Windows 11 tested).
- WebView2 runtime — the installer embeds the bootstrapper and installs it if missing, which needs
  internet the same way the model download does.
- ~3 GiB free disk for the app plus the smaller model, ~5 GiB for the 3B model.
- Internet for the first-run model download. After that the app never reaches the network.

## Install

Double-click the setup file. It installs for the current user into
`%LOCALAPPDATA%\NEXUS AI`, creates a Start-menu shortcut, and shows no UAC prompt. The engine is
installed beside the app in `engine\`.

Silent install (what `tools/m6-gate.mjs` does):

```powershell
& '.\NEXUS-AI_0.1.0_x64-setup.exe' /S /D=C:\path\without\spaces
```

## First launch

1. A welcome screen reads this machine: total and free RAM, physical cores, free disk, and the
   models folder (`%LOCALAPPDATA%\NexusAI\models`).
2. It recommends one file by RAM: **Llama 3.2 1B Instruct** below 16 GiB, **Llama 3.2 3B Instruct**
   at 16 GiB and above. Both are Q4_K_M GGUF, from huggingface.co.
3. Tick the licence checkbox — the link opens the Llama 3.2 Community Licence.
4. Press **Download**. Progress, bytes/second and Cancel are live. Cancel deletes the partial file;
   a failure keeps it and Retry resumes from where it stopped.
5. After the transfer, the app compares the file's SHA-256 with the pinned value. Only then is it
   renamed from `.part` to its model name. A mismatch deletes the file and shows the digest.
6. Chat is usable. If you chose **Do this later**, the app says Chat will refuse to answer rather
   than inventing one; Model Manager has an install panel for later.

Download speed is whatever your link to huggingface.co gives: measured 66–114 kB/s on the
development machine, so the 1B file took a few hours and the 3B longer. The download resumes if the
app is closed and reopened.

## Where data lives

| What | Path |
| --- | --- |
| Program + engine | `%LOCALAPPDATA%\NEXUS AI\` |
| Model weights | `%LOCALAPPDATA%\NexusAI\models\` (or `NEXUS_MODELS_DIR`, or `D:\NEXUS-MODELS` if it exists) |
| Database, settings, knowledge | `%APPDATA%\NexusAI\` (`nexus.db`, SQLite WAL) |

## Uninstall

Settings → Apps → NEXUS AI → Uninstall (or `uninstall.exe` in the install folder, or `/S` for
silent). The uninstaller removes the program and the engine. It **does not** delete the model
weights in `%LOCALAPPDATA%\NexusAI\models` or your database in `%APPDATA%\NexusAI` — deleting a
multi-hour download without being asked is not something an uninstaller should do. Remove those two
folders yourself if you want a clean machine.

## Troubleshooting

| Symptom | Meaning | What to do |
| --- | --- | --- |
| "Windows protected your PC" | Unsigned installer (KI-23) | Compare the SHA-256, then More info → Run anyway |
| Download very slow | Link speed to huggingface.co (KI-24) | Let it run; it resumes across restarts |
| "This machine could not be measured" | The OS refused the RAM probe | Nothing was offered because no honest recommendation exists; retry |
| Chat refuses to answer | No verified model on disk | Model Manager → install panel |
| `engine.crashed` banner | The engine process died | The next send restarts it; usage resets |
