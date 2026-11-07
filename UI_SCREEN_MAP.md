# NEXUS AI — UI Screen Map (Phase 1)

Navigation model: persistent left **Sidebar** (11 sections) + route-aware
**Topbar** (prototype badge, active-model chip, offline/online switch, theme
toggle). Optional right **context rail** per screen (≥1280 px). Routing is
HashRouter so the future Tauri bundle works from the filesystem.

```
/dashboard  → Dashboard          quick actions cross-link everywhere
/chat       → AI Chat            → /chat/:conversationId
/chat?new=1 → creates a fresh conversation (from Dashboard quick action)
/agents     → Agent Management   ← from Dashboard "Manage agents"
/models     → Model Manager      ← from Topbar model chip & Dashboard
/memory     → Memory Center
/knowledge  → Knowledge Base
/tools      → Tools & Skills     ← from Dashboard "Review tool permissions"
/learning   → Learning Lab
/internet   → Internet Center    ← Dashboard connectivity card; Settings Internet row
/activity   → Activity Center    ← Dashboard "Recent activity"
/settings   → Settings (13 internal sections, sub-nav inside the page)
```

## Screen inventory

### 1. Dashboard
Welcome + status badges (system nominal / offline / pending memories / agent
count) · CPU·RAM·GPU sparkline trio (mock telemetry, refresh button with
"not real sensors" tooltip) · model availability 0/10 (honest) · storage meter
· active agents list · connectivity card · recent conversations (deep-link to
thread) · recent activity · context rail: active model spec, hardware, quick
actions.

### 2. AI Chat
Conversation list (search, pin, rename modal w/ validation, delete, context
menus) · thread header (model + agent Select, settings modal: temperature /
system prompt / context-strategy contract, clear-with-ConfirmDialog) ·
markdown bubbles with timestamps, copy, regenerate (new canned reply) · code
blocks with copy · attachment chips (no analysis) · composer (Enter/Shift+Enter)
· simulated-thinking row · context usage rail (char/4 estimate, labeled).

### 3. Agent Management
Featured Universal Agent + 6 specialized prototypes (Developer, Research,
Document Analyst, Data Analyst, Personal Assistant, System Administrator) ·
capability chips · enable/disable · model assignment (with "not installed"
reality note) · create/edit via validated modal · menu: details/duplicate/
disable · filters + empty state · rail: platform status.

### 4. Model Manager
Tabs: **Installed (deliberately empty — nothing is installed)** / Catalog
(10 mock models) · specs incl. quantization, context window, size, est. RAM,
GPU recommendation, version, update date · hardware-compatibility indicator vs
the i5-8250U/20 GB reference machine · set-active (writes global state) ·
download/update controls that explicitly refuse ("no download in Phase 1") ·
compare up to 3 models side-by-side · search + sort · rail: hardware profile,
RAM headroom.

### 5. Memory Center
Five tier tabs (short/long/preferences/projects/conversations) over mock
records · approval pipeline (pending → approve/reject with "Approve all") ·
search across everything · edit modal (validation, history-append) · delete
confirm · per-record history timeline · rail: tier stats + what-tiers-mean.

### 6. Knowledge Base
Folder tree (from parent/child mock structure) · document list with type/collection
filters · indexing states (indexed/indexing/pending/failed) with simulated
re-index transitions · add-documents modal (fake upload → pending→indexing→indexed)
· preview modal (simulated) · move/delete · rail: collections, file types, storage.

### 7. Tools & Skills
7 categories (File management, PowerShell, Python, Coding, Document processing,
System operations, Web research) · permission chips + approval-gating badges ·
enable/disable + simulated run test (nothing executes) · custom skill builder
(validated steps) with edit/delete · rail: security model summary.

### 8. Learning Lab
Explainer: memory learning vs instruction improvement vs fine-tuning (fine-tuning
explicitly not automatic) · 7-step pipeline strip (correction → detection →
classification → root cause → suggestions → approval → apply/version) · event
cards (corrections, mistakes, errors) with severity/category/root-cause and
per-suggestion approve/reject · regression-test checklist · instruction version
timeline with rollback + confirm · open/resolved filters · manual-correction logger.

### 9. Internet Center
Offline/Online segmented switch (global state) · permission toggles (offline
default, per-agent, per-request, allow-list, no full-context, private-doc upload
block) · per-agent access table · trusted-sources allow/block + validated add ·
research config · update history (model/app/skill) + simulated check · rail:
connection status + data-locality explainer.

### 10. Activity Center
Timeline grouped by kind (task/tool/model/error/warning/approval) with icons
and connector rail · 7 filter tabs + search · expandable rows with simulated
JSON detail · inline approve/reject for pending approvals · export refuses
honestly · rail: today's counts + error meter.

### 11. Settings
13 internal sections: General · Appearance (theme actually switches; font-scale
slider really applies) · Language · Hardware (mock profile, RAM floor, power
profile) · Models (default = real cross-screen state change) · Agents · Memory
(approval-required default ON, purge confirm) · Internet (mirror + jump link) ·
Security · Privacy (all-local table) · Backup (simulated create/restore) ·
Portability (Tauri-era promises) · About (logo, version, Phase 1 scope notes).
Per-section dirty tracking with Save/Discard bar.
