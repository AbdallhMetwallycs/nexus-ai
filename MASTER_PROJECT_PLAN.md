# MASTER_PROJECT_PLAN.md — NEXUS AI

**Version:** 1.0 · **Updated:** 2026-11-12 · **Owner:** project owner (single-user product)
**Status of record:** Phase 1 complete and approved; Phase 2 M0–M1.2 done; M1 core + shell landed and
being verified end to end; M2 next.

## 1. Product definition

NEXUS AI is a standalone Windows desktop application that runs a local language model on the
owner's own machine. It provides chat, model management, knowledge/memory, tools and a learning
loop — with no account, no cloud dependency, and no data leaving the computer.

**Product boundary (permanent):** NEXUS AI does not train or fine-tune model weights. "Learning"
means instructions, memory and retrieval the owner approves, never gradient updates.

**Promise the app must keep:** every screen either does the real thing or says plainly that it is a
demo. This is enforced by the honesty swap in `PHASE2_MILESTONES.md` and audited in
`IMPLEMENTATION_STATUS.md`.

## 2. Users and jobs

| Job | Screen | Today |
| --- | --- | --- |
| Ask a question and get a real answer offline | Chat | **Real** (local engine, streamed, measured usage) |
| See and load installed models | Model Manager → Installed | **Real** (real GGUF metadata, real load) |
| Browse/download new models | Model Manager → Discover | Demo, explicitly labelled |
| Keep conversations after restart | Chat | **Not yet** (M2) |
| Ask questions about own documents | Knowledge Base | Demo (M3) |
| Have the agent do multi-step work | Agents / Tools | Demo (M4) |
| Improve behaviour from corrections | Learning Lab | Demo (M5) |
| Install the app like a normal program | Installer | Not yet (M6) |

## 3. Hardware envelope (measured, not assumed)

Reference machine: Intel i5-8250U (4 physical / 8 logical cores), 20.3 GB RAM, no discrete GPU,
Windows 11, WebView2 157.x. All numbers in `MEASUREMENTS.md`.

- Decode: **~4.9 tokens/s** sustained on a 3B Q4_K_M model.
- Prefill: **~19 tokens/s** — a 710-token prompt costs ~36 s before the first token.
- RAM: **private ≈ 1495 MB + 0.1106 MB per context token**; 8k context ≈ 2.4 GB private.
- Consequence: the app is usable for short prompts and short answers. Long documents are a
  prompt-cache and retrieval problem (M3), not a "buy a bigger model" problem.

The recommendation engine must keep deriving guidance from measured capability, never from a
hardcoded machine profile.

## 4. Architecture in one page

```
React UI (approved Phase 1) ── ipc({command,args}) ──> Tauri 2 shell (src-tauri)
        ▲                                                  │
        │ events: chat://token, chat://usage, model://state │  blocking thread per command
        └──────────────────────────────────────────────────┤
                                                           ▼
                                    nexus-core: dispatch · engine supervisor · registry ·
                                    admission · inference · net (loopback HTTP/SSE) · system
                                                           │
                                                           ▼
                              llama-server.exe b12189, 127.0.0.1:<ephemeral>, bearer token,
                              --offline --metrics -fa on --n-gpu-layers 0 --threads <physical>
```

Details: `ARCHITECTURE.md`, `PHASE2_ARCHITECTURE_PLAN.md`, `PHASE2_IPC_CONTRACT.md`,
`PHASE2_SIDECAR_SPEC.md`, `SECURITY_MODEL.md`.

## 5. Delivery plan

| Phase | Content | Status |
| --- | --- | --- |
| Phase 1 | Complete UI prototype, all screens, approved design | **Done** — approved 2026-11-07 (`APPROVE UI - START PHASE 2`) |
| Phase 2 · M0–M0.5 | Architecture lock, IPC contract as TypeScript types | Done |
| Phase 2 · M1.x | Toolchain, engine acquisition, one model, measurements | Done |
| Phase 2 · M1 | Real answer end to end: core, shell, streaming, stop, crash recovery | **Core + shell done, UI gate in progress** |
| Phase 2 · M2 | SQLite persistence, backup/restore | Next |
| Phase 2 · M3 | Knowledge base, retrieval, memory | Planned |
| Phase 2 · M4 | Tools, approvals, one working agent | Planned |
| Phase 2 · M5 | Learning loop (instructions, not weights) | Planned |
| Phase 2 · M6 | Packaging, signing, hardware telemetry, v1.0 | Planned |

Milestone exit gates are executable and live in `PHASE2_MILESTONES.md`; the roadmap view with
dependencies is `PROJECT_ROADMAP.md`.

## 6. Definition of done for Phase 2

1. Every `DemoNotice` is gone because the screen behind it became real — or it is still there
   because the screen is still a demo. No third state.
2. The ten policy invariants are automated tests, including fail-closed cases.
3. Measurement checklist has real numbers produced by the shipped code.
4. Installer runs on a clean Windows profile, offline, with no prior state.
5. Each milestone carries a tag and recorded gate output.

## 7. Quality bar

- **Evidence over assertion.** Commands and their output are recorded in `TEST_RESULTS.md` /
  `MEASUREMENTS.md`; a green build alone proves nothing about behaviour.
- **Fail closed.** Unknown memory, missing model, poisoned lock, dead engine: refuse and explain.
- **Reversibility.** Phase 1 remains at `84cb1a8`; no destructive migration without a verified
  backup.
- **The machine is a stakeholder.** Nothing defaults to thrashing RAM or the SMR disk.

## 8. Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Prefill latency makes long-context chat feel broken | Product | Prompt-cache reuse, retrieval instead of stuffing, honest progress UI |
| RAM ceiling on 20 GB laptops | Crashes / swaps | Measured admission, ~16k cap, fail closed |
| Single model, single engine instance | Model switch costs 6–38 s | Say so in the UI; keep one resident model |
| Tool execution can damage files | Data loss | M4 approval lifecycle + path policy invariants before any tool ships |
| Unsigned binaries and no updater | Trust | M6 signing; document current limits in `SECURITY_MODEL.md` |
| Scope creep re-opening approved UI | Lost time | Phase 1 is frozen; changes are additive and honesty-driven |

## 9. Governance

- Owner authorises: installs, downloads, new network paths, destructive operations, releases.
  The checkpoint table is `PHASE2_MILESTONES.md` §3.
- Decisions are numbered in `DECISION_LOG.md`; architecture decisions get an ADR entry in
  `ARCHITECTURE_DECISIONS.md`.
- Status documents are updated in the same commit as the change they describe:
  `IMPLEMENTATION_STATUS.md`, `TEST_RESULTS.md`, `KNOWN_ISSUES.md`, `TECHNICAL_DEBT.md`,
  `CHANGELOG.md`.
- Agents working in this repo follow `AGENTS.md`.
