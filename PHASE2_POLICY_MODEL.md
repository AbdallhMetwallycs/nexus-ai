# NEXUS AI — Phase 2 Policy Model (M0 draft)

**Doc:** the single enforcement point for offline, approval, permissions, and privacy
**Written:** 2026-11-07 · **Status:** for owner approval
**Grounded in:** `INTERNET_PERMISSION_DEFAULTS` (6 keys in `src/data/internet.ts`), `ToolDef`
(`permissions`, `needsApproval`, `status`), `MemoryRecord.approval`, the Settings Security and
Privacy sections (`redact`, `telemetry`), and the approval-gating copy already shown in the Tools &
Skills context rail.

No policy code exists. This document defines what M4 will implement.

---

## 1. The one rule

**Policy is enforced in the core, at the moment of effect.** A screen's toggle is a *view* of a
policy value, never the enforcement of it.

The Phase 1 UI already makes this promise in words — the Internet Center says "No network stack is
wired to this UI", the Tools rail says approval-required tools "cannot act until a human confirms
each call". The architecture has to make that promise structurally true: every path that can touch
the network, a file, a process, or a model's context passes through one function that can say no.

Consequences:

- A UI bug, a WebView compromise, or a hand-edited settings file cannot grant itself a permission,
  because the grant is checked in the core against the stored row, not against a value the UI
  supplied with the request.
- A tool cannot be "run anyway" by any caller: `tool.testRun` and `agent.run` both go through the
  scheduler, which asks policy before dispatch.
- Denials are as observable as grants. A silent denial is indistinguishable from a bug, and the
  owner would reasonably lose trust in the whole gating model.

---

## 2. Policy inputs

| Input | Source | Phase 1 equivalent |
|---|---|---|
| Connection mode | `settings.internet.mode` ∈ `offline` \| `online` | `PlatformContext.online` |
| Global switches | 6 keys in `INTERNET_PERMISSION_DEFAULTS`: `offlineByDefault`, `perAgentControl`, `perRequestPrompt`, `allowListOnly`, `sendFullContext`, `blockUploadsOfPrivateDocs` — plus a rate limit the Internet screen sets separately | Internet Center switches |
| Agent grant | `net.agentGrants()` per agent | per-agent internet switches |
| Tool state | `tool.enabled`, `tool.needsApproval`, `tool.status` | Tools screen toggles |
| Standing grants | `tool_grant(scope='always')` | *new in Phase 2* |
| Memory policy | `settings.memory.requireApproval` | Memory Center pending/approved states |
| Context policy | `settings.security.redact`, `sendFullContext` | Security section redaction toggle |
| Telemetry | `settings.privacy.telemetry`, **default off** | Privacy section toggle |
| Roots | `kb_root` allow-listed paths | Knowledge Base folder tree |

Defaults are the Phase 1 values: offline, per-agent control on, per-request prompt on, allow-list
only on, full-context sending off, private-document upload blocking on, memory approval required,
redaction on, telemetry off. The prototype shipped those defaults deliberately, so the real build
inherits them rather than inventing them.

---

## 3. Decision points

Policy is consulted at exactly seven effect points. Any new capability must be routed through one
of them; "it didn't fit a decision point" is a design smell worth stopping on.

| # | Decision point | Question asked | Verdicts |
|---|---|---|---|
| 1 | **Network egress** | May this agent reach this URL now? | allow · deny(`policy.offline`) · require approval |
| 2 | **Tool execution** | May this tool run with these permissions? | allow · require approval · deny |
| 3 | **Filesystem root** | Is this path inside an allow-listed root? | allow · deny(`policy.root_denied`) |
| 4 | **Model load** | Does this model fit measured RAM? | allow · confirm · deny(`model.ram_admission_failed`) |
| 5 | **Memory write** | May this observation be persisted as fact? | store-pending · store-approved · reject |
| 6 | **Context assembly** | What goes into the prompt? | redact · truncate · exclude private docs |
| 7 | **Instruction change** | May behaviour be altered? | require approval · apply versioned |

### 3.1 Evaluation order (network)

Fixed order, short-circuiting, so the reasoning is always explainable in one sentence:

```
1. mode == offline            → deny (policy.offline), record net://blocked
2. perAgentControl && !grant  → deny, record
3. allowListOnly && !match    → deny, record
4. sendFullContext == false   → strip context (allowed, degraded)
5. blockUploadsOfPrivateDocs  → deny if payload references a private doc
6. perRequestPrompt           → require approval (PendingApproval kind net_fetch)
7. otherwise                  → allow, record
```

Rate limiting is applied after step 7 and before dispatch; exceeding it is a denial with its own
code, not a silent queue.

### 3.2 Evaluation order (tool)

```
1. tool.status == 'error'     → deny (the Tools screen already blocks enable/run in this state)
2. !tool.enabled              → deny
3. permission not declared    → deny (a tool cannot use a permission it never declared)
4. path/root check            → deny(policy.root_denied)
5. standing grant scope=always→ allow, record
6. needsApproval              → require approval (PendingApproval kind tool_call)
7. otherwise                  → allow, record
```

Step 3 matters more than it looks: it is what makes the declared `permissions[]` array a real
boundary instead of documentation.

---

## 4. Approval lifecycle

```
requested ──► pending ──┬──► approved(once)    ──► executed ──► result logged
                        ├──► approved(always) ──► standing grant row
                        ├──► rejected         ──► denied action logged
                        └──► expired          ──► treated as rejected
```

Rules that make this trustworthy rather than ceremonial:

- **The summary is written for a human.** `summary` states the effect in plain language ("Delete
  3 files in D:\Reports"), not the internal call. An approval dialog whose text is a JSON blob
  trains the owner to click through it, which is worse than no dialog.
- **`always` is visible and revocable.** A standing grant appears in the Tools screen with its
  scope and roots, and revoking it takes effect on the next call, not after a restart.
- **Expiry is denial.** Pending approvals expire on a timer (default 5 minutes; unanswered prompts
  during an unattended run must not accumulate into a permission queue).
- **Timeouts while the app is closed do not auto-approve.** A request that was never seen is not a
  request that was agreed to; on next launch the queue shows what expired unattended.
- **One approval, one execution.** A granted `tool_call` is consumed by exactly one dispatch; a
  retry with different arguments re-asks.
- **Denials are first-class.** Rejected and expired rows land in the Activity log with the same
  detail as approvals, because the interesting history of a permission system is mostly the times
  it said no.

### 4.1 Approval kinds

| Kind | Raised by | Typical detail |
|---|---|---|
| `tool_call` | tool runtime | command line, target paths |
| `memory_write` | memory service | the exact text to be stored |
| `net_fetch` | policy at egress | full URL + requesting agent + reason |
| `model_download` | model registry | URL, size, RAM estimate |
| `instruction_change` | learning service | diff of the prompt change |

`memory_write` and `instruction_change` are the two that protect the owner's *own data and
behaviour* rather than their machine, and they are the reason the Memory and Learning screens exist
in the prototype at all.

---

## 5. Context assembly policy

What enters a prompt is a privacy decision, not a formatting one.

- **Redaction** (`settings.security.redact`): field patterns (keys, tokens, national id formats)
  are masked before assembly. Redaction is applied to retrieved content and tool output, not only
  to user input — the leak path that actually happens is a document's contents being echoed back.
- **`sendFullContext == false`**: web tools receive the query, not the conversation.
- **Private documents**: tagged docs are excluded from any payload leaving the machine while
  `blockUploadsOfPrivateDocs` is on, and the exclusion is reported in the Activity log so the
  degraded answer is explainable.
- **Memory injection**: only `approval = 'approved'` rows are eligible. Pending rows are invisible
  to retrieval — which is precisely the promise the Memory Center already makes.
- **Token budget**: assembled by the core with a measured count, and the Chat rail shows the real
  number with `measured: true` once it is one.

---

## 6. Invariants (the testable list)

These are the acceptance checks M4 must pass. Each is written so it can be executed and its output
recorded, in the same manner as the Phase 1 verification set.

1. With mode `offline`, no code path in the core can open a socket to a non-loopback address.
   *Check:* attempt a `net.fetch` and assert `policy.offline` plus a `net://blocked` event, with no
   DNS resolution observed.
2. Flipping a UI toggle cannot change behaviour without the corresponding stored row.
   *Check:* hand-edit `settings` to claim a grant the tool never declared; assert step 3 denial.
3. A `needsApproval` tool cannot execute without an `approved` row consuming it.
   *Check:* dispatch attempt without approval; assert denial and a logged rejection.
4. One approval cannot authorise two different argument sets.
   *Check:* approve, run, re-run with changed args; assert a second prompt.
5. An expired approval behaves exactly like a rejected one.
   *Check:* let one expire; assert no execution, `expired` decision, activity row.
6. A pending memory is never retrieved into a prompt.
   *Check:* create pending, run chat; assert absence in assembled context.
7. Path traversal outside an allow-listed root is refused before any filesystem call.
   *Check:* `..\..\` and symlink cases; assert `policy.root_denied`.
8. Model load above the admission ceiling refuses without allocating.
   *Check:* request an "Exceeds this machine" model; assert `model.ram_admission_failed` and that
   RSS did not move.
9. Telemetry stays off unless explicitly enabled, and "off" means no request, not an anonymous one.
10. Every denial, timeout and error writes an activity row with a `correlation_id`.

---

## 7. Failure and ambiguity handling

| Situation | Behaviour | Why |
|---|---|---|
| Policy row unreadable | deny, surface error state | fail closed; a broken permission check must never default to open |
| Approval dialog cannot be shown (headless job) | deny on expiry, queue visible at next launch | an unseen prompt is not consent |
| Two requests race for one grant | serialise through the scheduler | prevents one approval authorising two effects |
| Tool declares a permission it lacks an implementation for | deny + `not_implemented` | honest gap beats silent partial capability |
| Owner grants `always` then edits the root list | grant re-validated against new roots, downgrade logged | a grant must not outlive the scope it was granted under |

---

## 8. What this model explicitly refuses to do

- No background daemons that survive app exit.
- No auto-approval of "safe" tools by heuristic; a tool is either declared `needsApproval: false`
  by the owner or it is gated.
- No cloud sync, no account, no analytics by default.
- No fine-tuning, and therefore no policy for it — the Learning Lab's stated boundary stays a
  real boundary.
- No permission granted through a config file that the core does not re-validate against declared
  capabilities.

---

## 9. Companion documents

`PHASE2_IPC_CONTRACT.md` (`approval.*`, `net.*`, `tool.*`) · `PHASE2_DATA_MODEL.md` (`approval`,
`tool_grant`, `settings`) · `ARCHITECTURE.md` (§6 posture) · `PHASE2_SIDECAR_SPEC.md`
