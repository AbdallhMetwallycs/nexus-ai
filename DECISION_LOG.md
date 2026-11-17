# NEXUS AI — Decision Log (Phase 1)

Decisions that shaped the UI-only prototype, with rationale and trade-offs.

## Process & scope

**D-001 — UI-first, hard phase gate.** The entire frontend is finished before
any backend/AI work. Phase 2 (runtime, models, DB, agent engine) starts only on
the exact approval `APPROVE UI — START PHASE 2`. *Why:* de-risk the experience
and let the owner review the product before committing to heavy engineering.

**D-002 — Workspace was empty; built clean.** `D:\NEXUS-AI` contained nothing to
preserve, so a fresh frontend-only project was scaffolded. No unrelated project,
repo, or knowledge base was touched.

**D-003 — Honesty is a design feature, not a disclaimer.** Every simulated
action states what did *not* happen. A violet `DemoNotice` channel, a permanent
"UI prototype · Phase 1" topbar badge, and deterministic-but-labeled telemetry
implement this. *Why:* the brief forbids pretending mock functionality is real;
making that a visual system keeps it consistent instead of bolted on.

## Technology

**D-004 — React 18 + TypeScript + Vite 5 + Tailwind 3 + lucide-react.** The
stack named in the brief. No component kit (MUI/shadcn), no state library, no
chart library. *Why:* "prepare for Tauri without unnecessary dependencies" and
"distinctive visual identity" both argue for a small bespoke system; a kit would
fight the design language and bloat the bundle.

**D-005 — Zero hard third-party runtime deps beyond React/router/icons.**
Markdown, sparklines, menus, toasts, modals, theming are hand-built in
`src/lib` and `src/components/ui`. *Why:* fewer upgrade surprises at Tauri
packaging, full control of the premium aesthetic, and a smaller attack surface.

**D-006 — HashRouter + `base: './'`.** *Why:* Tauri serves the built app from
the filesystem where `BrowserRouter` history paths break; hash routing works
from `file://` and any static host. Chosen now to avoid a later rewrite.

**D-007 — Standalone (no Qoder dependency).** The app uses only public npm
packages, local files, and OS fonts as fallback. *Why:* brief requirement — the
shipped app must not depend on Qoder.

## Architecture

**D-008 — Mock data is the Phase 2 seam.** All screen data lives in typed arrays
under `src/data/` (`types.ts` defines the shared vocabulary). Screens read
arrays and call plain setters. In Phase 2 these become repository/API/fetch
calls with the same shapes. *Why:* keeps the UI decoupled and makes integration
additive rather than a rewrite.

**D-009 — Three-layer component model.** `ui/` (primitives) → `common/`
(page chrome: PageHeader, WorkArea, ContextPanelCard, Logo) → `pages/`. Shared
cross-screen state (active model, online, sidebar) is one small `PlatformContext`;
everything else is local page state. *Why:* no heavy store is justified for UI
state; the seam for real state management stays obvious.

**D-010 — Context rail is per-screen, optional.** `WorkArea.contextPanel`
renders the right rail only at ≥xl and only where it adds value (model spec,
hardware, approvals). *Why:* the brief warns against overcrowding; the rail
keeps secondary/technical detail out of the main flow.

**D-011 — Dark-first with a variable-driven light theme.** Theme = CSS variables
toggled on `<html>`; components never hardcode hex. *Why:* satisfies
"support light/dark if practical" essentially for free and keeps a single
maintainable token source. Dark is the identity theme.

## UX

**D-012 — No dead buttons.** Every control performs a real prototype action
(state change, modal, toast, filter, selection). Where the real effect is
impossible in Phase 1 (download, execute, network), the control runs the UI
flow and then truthfully reports it was simulated. *Why:* brief requirement +
trust.

**D-013 — Chat replies are canned, latency is a timer.** `SIMULATED_REPLIES`
with a short delay stand in for inference. *Why:* demonstrates the full message/
thinking/regenerate/stream skeleton now so Phase 2 can replace the timer with a
token stream without touching layout.

**D-014 — Model Manager "Installed" tab is intentionally empty.** *Why:* the
brief requires clearly indicating that no models are actually installed; an
honest empty state communicates this better than fake "installed" rows.

**D-015 — Learning Lab distinguishes three learning types.** Memory learning
(retrieval), instruction improvement (prompt steering), and fine-tuning (weights)
are explained separately, with fine-tuning marked not-automatic and out of
Phase-2 auto scope. *Why:* the brief forbids claiming the model learns
automatically; the UI must teach the real mental model.

**D-016 — Accessibility is baseline, not an add-on.** `FieldShell` gives every
input an `aria-describedby`-wired label/error; switches/tabs/menus/dialogs carry
roles and keyboard handling; global `:focus-visible`; Esc closes overlays.
*Why:* "support keyboard navigation" is a hard requirement.

**D-017 — Byte formatting lives in one helper, never re-suffixed.** The Knowledge
Base storage rail originally rendered "2.4 GB GB" because the page appended its own
unit to `formatBytes()`, which already returns a value with a unit. Fixed at the call
site and the rule recorded here. *Why:* a single owner for unit formatting prevents
duplicated or contradictory suffixes as more screens report disk and model sizes.

**D-018 — The fallback knowledge collection is "Uncategorized", not "Everything".**
Documents whose folder has no named collection fall back to this label. As
"Everything" it read as a total-of-all-documents row while showing 0, which looked
like a counting bug in a screen whose whole job is honest accounting.
*Why:* the rail must be readable without cross-checking the code.

## Phase 2 decisions (owner-approved 2026-11-07)

**D-019 — Phase 2 gate opened.** The owner sent `APPROVE UI — START PHASE 2` on 2026-11-07.
Phase 2 work is authorised, scoped by the M0 decision below. *Why:* recorded so the exact
authorisation moment is auditable rather than inferred from a conversation.

**D-020 — Inference runtime: llama.cpp sidecar.** Chosen over Ollama-as-provider and over a remote
API. The engine runs as a supervised child process bound to `127.0.0.1` with a per-launch token.
*Why:* control of quantization, thread count, context cap, and the RAM admission check; weights
stay in an owner-visible folder; a remote provider contradicts the offline-first premise.
Consequence: Rust and MSVC build tools become prerequisites, and the engine is acquired as a
pinned prebuilt archive rather than compiled from source.

**D-021 — M0 is documents only; no installs, no downloads, no scaffold.** The owner chose the
docs-lock path over "contract plus scaffold now". *Why:* the architecture decisions (process
topology, schema, policy invariants) are cheap to change on paper and expensive to change after
`src-tauri/` exists.

**D-022 — No model weights on this machine yet.** The owner declined the 7B Q4 and the 3B options
for now. *Why:* a 2–5 GB download is the first irreversible-ish disk commitment in the project and
it should follow the runtime verification, not precede it. Consequence: M1's first step is verifying
the pinned llama.cpp archive's actual contents and `--help`, because the current unified
`llama serve` binary shape rests on one third-party source.

**D-023 — Version control established at the Phase 1 boundary.** `git init` plus `.gitignore`,
baseline commit `84cb1a8` covering the verified Phase 1 UI and the Phase 2 plan; local only, no
remote. `dist/` and `node_modules/` are ignored; screenshots are committed as evidence.
*Why:* every Phase 2 gate needs a known-good tag to compare against. Side effect found and
corrected: `PHASE_1_COMPLETION_REPORT.md` had listed `.gitignore` among Phase 1 files, which was
not true until this commit — the report now says so.

**D-024 — Environment measured, not assumed, before writing the plan.** Probed 2026-11-07:
git 2.45.1 ✓, node v24.17.0 ✓, npm 11.13.0 ✓, `rustc`/`cargo`/`cmake`/`cl` **all absent**, `D:` =
252 GB total with 149 GB free. *Why:* the missing toolchain is the real M1 cost and the 512 GB /
143 GB figure in the Phase 1 mock profile describes C:, not the volume that will hold app data —
both facts change the plan and neither was knowable from the code.
*Superseded on the toolchain half by D-028; the probe method stands.*

**D-025 — The IPC contract is materialised as types before any runtime exists.** Owner chose
"materialise the IPC contract now" over waiting for M1. `src/contract/ipc.ts` holds the 96 commands and
10 event channels; `src/contract/client.ts` holds `NexusTransport`, a dependency-free structural probe
for a Tauri-style host, and the honest transport that answers every call with `not_implemented` and
never fires a subscription. No screen imports either file, and `package.json` is unchanged.
*Why:* a contract that only exists as prose gets re-litigated at implementation time; as types it is
checked by the compiler on every commit from now on. Verified 2026-11-07: `tsc --noEmit` exit 0,
`npm run build` exit 0 with the **same output hashes as Phase 1** (`index-o-Cdud1n.js` 425.85 kB,
`index-B__IBTZ4.css` 33.04 kB, 1613 modules) — byte-identical bundle is the proof that adding the
seam changed no screen. Runtime and type-level checks were run from scratch files in a temp directory
(so the repo gained no test dependency): the honest transport refused 2 sampled commands with
`not_implemented`, a stubbed host bridge routed calls and unwrapped event payloads correctly, a raw
string rejection degraded to `internal` rather than a fake success, and 7 deliberate misuse attempts
(`engine.status` with args, `model.get` without id, unknown command, unknown field, unknown result
field) all failed to compile.

**D-026 — Argument presence is derived, not declared per command.** `ArgsTuple` maps `args: undefined`
to a parameter that does not exist, an args type whose every field is optional to an optional object,
and anything else to a required parameter. *Why:* the alternative — writing `args?` on 96 rows — lets
the signature and the call site drift. `{} extends A` is the same test the compiler applies when it
accepts the call, so `chat.list()` and `chat.list({ query: 'auth' })` are both legal while
`model.get()` without an id is a compile error. Documented in `PHASE2_IPC_CONTRACT.md` §1.

**D-027 — `chat.list` returns `ConversationSummary`, not `Conversation`.** The list projection drops
`messages` and adds `messageCount`. *Why:* the sidebar row renders only
`"{messages.length} msg · {timeAgo(updatedAt)}"` (`src/pages/Chat.tsx:264`), so shipping full
conversations would make the list's cost grow with the chat history on a 15 W CPU. Found while
materialising the contract: the code needed the projection before the document described it, and the
document was corrected in the same commit rather than left to rot.

**D-028 — The owner authorised the Rust + MSVC install, scoped to "verify, document, stop".** The
instruction was "先授权安装 Rust 和 MSVC Build Tools" — authorisation checkpoints 1 and 2 from
`PHASE2_MILESTONES.md` §3, and nothing else. Chosen at the same time: add the C++ workload to the
**existing** Visual Studio Community 2026 instance (18.11.2, instance `bcdd2c05`) instead of installing
Build Tools beside it, and let the installer pick the Windows SDK. Then the checkpoint scope was fixed
as "verify + document, then stop" and D-022 held ("still none — verify the runtime with no weights").
*Why it matters:* the M0 probe (D-024) recorded `rustc`/`cargo`/`cmake`/`cl` as absent, which was true
that morning and would have sent M1 looking for an install that already existed. Measured after the
install: rustc 1.99.1 (58cf8f9c3), cargo 1.99.1, rustup 1.29.3, host `x86_64-pc-windows-msvc`, LLVM
23.1.1, cl 19.51.36260 / MSVC toolset 14.51.36231, Windows SDK 10.0.26100.0. Three proofs, all in a
plain shell: `cargo build` + run (exit 0, live PID printed — cargo links against MSVC), `cargo clippy
--all-targets` (exit 0), and `cl` compiling and running a `<windows.h>` program that called
`GetCurrentProcessId()`, relinked against `user32.lib`. Cost: VS instance 9.09 GB, `.rustup` 1.30 GB,
package cache 4.76 GB; C: free 99.4 → 83.9 GB. The installer log ends `Exit Code: 0` while also
recording *"Updating instance state that a reboot is required"* — unverified either way, so the next
session reboots first.

**D-029 — VS 2026 renamed the C++ workload, and the installer reported success while installing nothing.**
`setup.exe modify --add Microsoft.VisualStudio.Workload.VCTools` returned **exit 0** and did nothing;
the log said "Cannot find package … in product graph. These package IDs weren't found… They may have
been renamed". The authoritative id came from the channel manifest (`VisualStudio.vsman`):
**`Microsoft.VisualStudio.Workload.NativeDesktop`**. Two more CLI facts: `setup.exe modify` rejects
`--wait` (exit 87, "Option 'wait' is unknown"), so completion must be detected from installed
artefacts; and `cmake`/`ninja` are not global commands but ship inside the instance, so a source build
has to run in the VS environment — the verified paths are
`…\VS\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe` and
`…\Microsoft\CMake\Ninja\ninja.exe`, and `where cmake` still finds nothing. *Why this is a decision and not a footnote:* it changes the standing
rule for every future install step — **an installer's exit code is not evidence; the artefact is** — and
that rule is what turns "installed" claims in this project's docs into checkable statements.

**D-030 — The engine is pinned to b12189, CPU x64, and lives outside the repo.** The owner authorised
"llama.cpp archive only" as the next step, with D-022 reaffirmed. Downloaded
`llama-b12189-bin-win-cpu-x64.zip` (24,749,596 B, byte-exact against the releases API) and extracted
52 files / 61 MB to `D:\NEXUS-SIDECAR\b12189\`. SHA-256
`f912ea5e3e397c63405c81e732131ab0fa6e72411c80546bb5ad643f7dd82aac` (MD5 `22180d8e…93955c`), version
string `0.9.0-dev (build 12189, commit 80d2c0c2c)`, built with Clang 20.1.8. *Why outside the repo:* a
third-party binary must never ride in a git checkout, and the zip stays beside it as the checksum
reference. *Why the caveat matters:* GitHub returned **no digest** for any of these 38 assets, so this
hash is our own baseline — it detects drift and proves a re-download matches, it does not establish
publisher intent. Provenance is HTTPS plus the exact asset name until we add a signature check, and
saying so is better than letting "checksum verified" imply more than it does.

**D-031 — The supervisor spawns `llama-server.exe`, not the unified `llama.exe`.** The zip ships both,
they load the same `llama-server-impl.dll`, and their help is identical (753 lines, one blank line
apart) — so this is not a capability choice, it is a surface choice. The unified binary exposes
`update` (rewrites the engine on disk) and `download` (reaches the network) as subcommands; the
standalone one has no subcommand parser at all (`llama-server.exe serve` → `invalid argument: serve`).
*Why:* "the engine never auto-updates" and the offline invariant should be properties of the process
we launch, not rules our code has to remember to obey. Pairs with `PHASE2_POLICY_MODEL.md` §6
invariant 1, which now names the engine in its text.

**D-032 — A weightless start is router mode, and the flag set moved under us.** Measured on b12189:
`llama-server.exe` with no `-m` logs `starting server in router mode` plus its own warning
`security: router mode enabled - do not expose to untrusted environments`, with `max_instances: 4` and
`models_autoload: true` visible in `/props`. So the vector gains `--models-max 1` and
`--no-models-autoload`, and the model arrives through `POST /models/load` — whose route is confirmed
(404 *File Not Found*, not unknown route) — so that **`engine.loadModel` now has a real home and the
admission check keeps authority**. Also measured: with a bad `-m` the process exits code 1 in 0.11 s
and never binds, so a load failure is indistinguishable from a crash and the path must be validated
before spawning; `/health` answers with no API key while `/v1/models` and `/metrics` return 401; CORS
defaults to `*` with credentials enabled; `--mlock`/`--no-mmap` are gone, replaced by
`-lm/--load-mode {auto|none|mmap|mlock|mmap+mlock|dio}`; and `--n-gpu-layers` defaults to `auto`, not
0 — a CPU-only baseline has to say so. Warm start without weights: socket at +98 ms, idle RSS 12.4 MB.
*Superseded in part by D-034: the `POST /models/load` half of this paragraph was a misreading, and the
two router pins it added left the vector again. The rest — the exit-on-bad-path, `/health`
authentication, CORS default, `-lm` enum and `-ngl auto` — stands and is still measured truth.*

**D-033 — D-022 lifted for exactly one model file, chosen by the owner.** The owner authorised
"one model file" to make the `PHASE2_SIDECAR_SPEC.md` §6 numbers measurable, then chose
`Llama-3.2-3B-Instruct-Q4_K_M.gguf` from `lmstudio-community` and the path `D:\NEXUS-MODELS\`.
Downloaded 1,879 MB; **size and SHA-256 both verified against the publisher's `lfs.oid`**
(`2019377440`, `e4f1a04d…210d9a`) — the first artefact in this project whose digest came from someone
other than us. Scope of the lift: this file, this machine, no other weights, and still no Hugging Face
integration in the app. *Why it matters:* it converts the entire M1 premise from argument to
measurement, and it is the difference between "the architecture is compatible with a 15 W laptop" and
"we know what happens on one."

**D-034 — The engine is spawned single-instance with `-m`; router mode is not usable for local files.**
With real weights in hand, the router's model endpoint was probed properly and answered
`POST /models {"model": "D:\\NEXUS-MODELS\\…gguf"}` → **400 `invalid HF repo format, expected
<user>/<model>[:quant]`**. The field is an HF repo id, so in b12189 router mode **cannot load a local
file over HTTP**, and the only way it acquires a model is a network fetch — forbidden by D-022's
surviving scope and by `--offline`. So: `-m <validated path>` at spawn, `--models-max 1` and
`--no-models-autoload` dropped, and the admission check moves from "before the load call" to "before
the spawn", which is where `ARCHITECTURE.md` §7 step 5 wanted it anyway. The M1.1 note that the route
was "confirmed live" was an inference from a 404 that looked like the server's own error format; the
correction cost one download and two honest re-reads, and it is recorded rather than quietly rewritten.

**D-035 — There is no unload and no shutdown route, so `engine.unloadModel` means killing the process.**
Against a loaded single-instance server: `POST /unload_model`, `POST /models/unload`,
`POST /models/<path>/unload`, `DELETE /models/<path>`, `DELETE /models/llama-server` and
`POST /shutdown` all return **404**. Live admin surface is `/health` (200, still unauthenticated),
`/props`, `/slots`, `/v1/models`, `/metrics` (501 unless `--metrics` is passed), and the two inference
routes. *Consequences, in order of how much they hurt:* a model switch costs the full cold start
(6–10 s warm, ~38 s cold) instead of an HTTP call; `engine.stop` is TerminateProcess, so "shut down
cleanly with the app" is a promise we can only keep by ending the pid; and any UI state that says
"model unloaded" implies a reload the user will feel. `PHASE2_IPC_CONTRACT.md` §3.1 was rewritten from
this evidence.

**D-036 — The measured envelope on this laptop: decode is survivable, prefill is the threat.**
`MEASUREMENTS.md`, all on the i5-8250U with 6.4 GB free: **4.93 t/s sustained** over 869 streamed
tokens (179 s), 4.6–5.9 t/s in short arms, **~19 t/s prefill**, TTFT **3.6 s on 80 prompt tokens and
36.6 s on 710**. RAM is linear in context: **private ≈ 1,495 MB + 0.1106 MB × tokens**, measured at
2k/8k/32k (1,722/2,401/5,120 MB) and within 1.1% of the KV-cache formula computed from GGUF head
counts — so the admission model can be arithmetic on metadata instead of a table of guesses. Three
policy consequences: (a) **`--ctx-size 0` is a hazard**, because 0 means "from the model", this model
advertises 131,072, and by the measured slope that is ~14.5 GB of KV — the engine loaded 32k at 5.1 GB
*without refusing*, which is exactly why the core's check exists; (b) **threads come from physical
cores** — 8 logical cost ~26% of decode against 4, and with `-fa off` at 8 threads prefill collapsed
2.7× to 7.99 t/s with decode samples spreading 4.26→1.86; (c) **cancel is batch-bound, not instant** —
1,744 ms from client abort to engine idle in one arm, 231 ms in another, so Stop cannot assume the CPU
stopped when the fetch rejected. *Why:* the premise survives, but not for the reason the M0 documents
gave. They treated tokens/sec as the risk; on this hardware the risk is the dead air before the first
token, which makes prompt-cache reuse a Phase 2 design requirement rather than an optimisation.

**D-037 — UI fonts are vendored, because a font CDN is still a network call.** `index.html` shipped
a Phase 1 `<link>` to `fonts.googleapis.com` / `fonts.gstatic.com`. The M1 gate recorded zero external
requests, but that is not proof: WebView2 may have served the CSS from its cache, and the cold-cache
behaviour was never measured. Rather than argue from an unmeasured assumption, Inter and JetBrains
Mono now come from `@fontsource-variable/*` (12 WOFF2 files, 302,728 bytes in `dist/assets/`) and the
built HTML contains no `http(s)://` URL. Tailwind prefers the variable families with the old names as
fallback, so the approved look is unchanged. *Why:* "local only" is a product boundary, and a request
the app cannot prove it never makes is not local. The npm fetch is development-time work, like the
earlier dependency fetches, and is recorded here per `AGENTS.md` rule 4.

**D-038 — The tagged M1 implementation stands; a duplicate in-worktree rewrite was discarded, not
merged.** While M1 was being resumed after a context break, `crates/nexus-core/{engine,registry,
admission,inference,dispatch,ipc_types}.rs` and `src-tauri/src/lib.rs` were re-implemented in the
worktree under a different internal API (`Core`/`Runtime`/`EventSink`, `CancelHandle`-per-send).
The history check showed the same milestone had already shipped — `m1-core` (`ff3edb5`) and
`m1-first-answer` (`ba15fa2`) — with a passing live UI gate, reuse logic in `Engine::start`, and 53
recorded tests. The rewrite passed 60 of its own tests and clippy, but its own live reuse assertion
failed (a repeat `engine.loadModel` took 9.26 s, i.e. a reload), so it was not equivalent. The seven
files were restored to `HEAD` — no tagged ref moved, no `git checkout --`/`reset --hard` used — and
the rewrite is preserved outside the repo at `%TEMP%\nexus-m1-rewrite-2026-11-16.patch`
(191,948 bytes, sha256 starts `595de1af`) for anyone who wants to mine the tests. *Why:* evidence
beats churn. A proven, gated implementation is not replaced by an unproven duplicate merely because
the duplicate is newer in the session, and a second implementation of the same seam is how contract
drift starts.

**D-039 — Persistence uses `rusqlite` with bundled SQLite, fetched from crates.io.** The store is
SQLite because the schema in `PHASE2_DATA_MODEL.md` needs transactions, WAL and FTS5, all of which
ship with SQLite itself; re-implementing them on files would be a second database. `rusqlite 0.32.1`
with the `bundled-full` and `backup` features compiles SQLite into the app, so no system DLL is
assumed and the online-backup API is available for `store.backup`/`store.restore`. The crates come
from crates.io, which is a development-time fetch recorded here per `AGENTS.md` rule 4; at runtime
nothing is downloaded and no network call is made.

**D-040 — `store.backups` is added to the contract (96 → 97 commands) so Settings can list files
that exist.** The contract already had backup/restore/export/purge but no listing command; a Backup
screen without one would have to invent rows, which is exactly the Phase 1 mock the milestone
replaces. The command returns the `backup_record` rows (id, name, path, size, createdAt,
schemaVersion, verified) and both `src/contract/ipc.ts` and `dispatch.rs` changed in the same edit.
`store.export` now also returns the path it wrote, because a toast that says "exported" without
saying where is not useful.

**D-041 — `chat.send` saves the question before any model-dependent refusal, and adopts the id the
UI already named.** M1 let the renderer own the id; a first send to a conversation the UI created
before the model check could either fork a second row or lose the turn on a `model.not_installed`
refusal. Now the message is appended first, then the model is resolved, so a restart shows the same
question beside the same error; `create_conversation_with_id` keeps the UI's id instead of
allocating a new one.

**D-042 — `models.active` and `appearance.theme` live in the `settings` table; localStorage is only
a pre-paint hint.** The M1 build remembered both in `localStorage`. The database is the record of
the owner's choice, so `Core::from_env` restores the active model when the registry can resolve it,
`ThemeProvider` reads `appearance.theme` on mount, and both write through `settings.patch`. If the
read fails, the current value stays and nothing is claimed to have loaded.

**D-043 — retrieval fuses SQLite FTS5 with a local hashed-vector cosine; no model is downloaded.**
M3's scope says "embedding", but a real embedding model would mean a second model file and a new
admission cost on a 20.3 GB laptop, and the offline rule forbids fetching one at runtime. Each
chunk is therefore vectorised into 256 dimensions by hashing its tokens (FNV-1a, signed), stored as
a little-endian `f32` BLOB in `kb_chunk.embedding`, and compared by cosine; the FTS5 `bm25` ranking
is fused with it by reciprocal-rank fusion at `k = 60`. This is a lexical lift, not semantics: it
helps when a query and a chunk share vocabulary in different orders, and it will not retrieve a
paraphrase that shares no words. `kb.search` returns `measured: true` only when every stored chunk
carries its vector, so the claim stays checkable. A real embedding backend is TD-20.

**D-044 — the folder watcher polls every 2 s; it does not use OS file notifications.**
`notify` would add a platform-specific dependency and a second failure surface for rename storm
handling; a 2 s poll of a 200-document tree costs 26.50 ms per search and a directory walk that is
far below the noise of model inference. Rename detection uses an FNV-1a fingerprint of `(size,
first 4 KiB)` combined with the path: a path that disappears and a fingerprint that reappears at a
new path is treated as a rename (the `kb_document` row keeps its id and chunks), and any other
change re-parses the file. The fingerprint is change detection, not a security hash.

**D-045 — a memory is proposed only on an explicit "remember …" request.** Inference-mining
ordinary conversation would fill the approval queue with guesses and make the pending list
untrustworthy. `chat.send` looks for an explicit prefix (English: "remember that", "remember:",
"keep in mind that", "note that", "please remember"; Arabic: "تذكر أن", "تذكر:", "احفظ أن",
"احفظ:") and stores exactly the remainder as a `pending` memory whose source is
`conversation:<id>`. Pending rows are excluded from retrieval in SQL, so approving is the only way
one can affect an answer; the gate proves it with 0 hits before and 1 after. Mining is future work,
not a hidden behaviour.

**D-046 — `kb.reindex` and `kb.watchRoot` are synchronous and record a finished job.**
There is no job queue until M4's scheduler, and a command that returned a `jobId` for work that had
not started would be the fake functionality the project forbids. Both commands do the scan inside
the call, write the `job` row with its measured counts and `finished` state, and return that id;
`kb.watchRoot` then starts the polling monitor. The cost is that a large first scan holds the core
mutex for its duration (TD-19), which is honest but not yet acceptable for a multi-GB folder.

**D-047 — M3 dependency fetches, recorded under rule 4.** `cargo` fetched these crates into
`Cargo.lock` for `crates/nexus-kb`: `lopdf 0.35` (PDF text), `calamine 0.26` (xlsx),
`csv 1.3` (csv), `zip =2.2.2` with `default-features = false, features = ["deflate"]` (docx
containers; pinned because calamine's newer zip major changes the API), `quick-xml 0.37` (docx
chapter/heading detection), and `tempfile 3` as a dev-dependency for parser fixtures. All are
compile-time, run offline, and none is a network client. This is development-time fetching, which
AGENTS.md rule 4 permits and requires recording; the application itself still downloads nothing.

**D-048 — one pure crate decides, and it is consulted at the moment of effect.** `crates/nexus-policy`
has no dependencies and no I/O: `decide_tool` answers `Allow`, `RequireApproval` or `Deny(code)` from
the tool declaration, the declared permissions, the standing grants, the pending approvals and the
path roots. The scheduler calls it immediately before each step *and* the tool runtime calls
`resolve_in_roots` again before touching the filesystem. A check that ran when the plan was queued
would be a check against a world that has since changed (a root removed, an app disabled, an
approval expired). Keeping the decision pure also makes the ten policy invariants cheap to test
without a store, a process or a window.

**D-049 — one execution slot, and a waiting approval frees it.** `nexus-job-runner` is a single
background thread with its own `Store` connection (SQLite WAL readers do not block). It claims one
queued job, runs its steps, and when a step needs a decision it records the approval, marks the step
`awaiting_approval` and puts the job back to `queued` — otherwise one person's unanswered prompt
would block every other job indefinitely. Claim order is priority then age, so a re-queued job is not
punished for the time it spent waiting. The gate proves serialisation with two plans whose
timestamps show the second started after the first finished. A 300 s expiry is recorded as a denial,
because "no answer" must never mean "yes".

**D-050 — an approval is bound to one argument set and consumed on use.** The hash is FNV-1a over
the tool id plus a canonical JSON serialisation of the arguments (sorted keys, no whitespace). The
approval stores that hash, and `approval_matches` refuses an approval whose hash differs, so
approving "write these 16 bytes to this file" cannot authorise a different write. `used_at` is set
on release, so a second identical call asks again. "Always allow" is the explicit escape: it writes
a standing grant for the declared permission, which the Tools details dialog shows and which
`tool.setGrant(..., 'never')` removes. Standing grants are per permission, not per argument set —
that is what the owner asked for by choosing Always.

**D-051 — the Developer Agent executes a plan; it does not plan yet.** The M4 agent takes a short
line-per-call plan (`fs.list <path>`, `fs.read <path>`, `fs.write <path> | <content>`, `python.run |`
and `powershell.run |` with the rest of the line as the script, `#` comments) and rejects an unknown
verb with `validation.field` naming the line before queueing anything. Calling a model to invent the
plan is M5's learning loop and would have made M4's exit gate untestable and non-deterministic. Only
`developer-agent` is runnable; any other agent returns `policy.not_allowed` rather than pretending.

**D-052 — M4 added no external dependency.** The only `Cargo.lock` change is the new workspace member
`nexus-policy` (version 0.1.0); no third-party crate was fetched. Nothing in M4 reaches the network,
and the gate's tools run only Python and PowerShell already present on the machine.

## Deferred (explicitly not in Phase 1)

LLM runtime (Ollama/llama.cpp), backend/API, databases, persistent memory,
real agent execution, internet/search/download, model training/fine-tuning, Tauri
build scripts. These are architecture-compatible and documented in the README's
integration section, but were not implemented, per the brief.

**Status update 2026-11-07:** Phase 2 opened (D-019), so the first group of these is now in
progress by design. Fine-tuning and any weight modification remain deferred indefinitely — that
item is a product boundary, not a schedule.
