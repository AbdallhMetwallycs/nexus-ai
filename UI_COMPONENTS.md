# NEXUS AI — UI Component Library

All primitives live in `src/components/ui/`, re-exported from `src/components/ui/index.ts`.
They are dependency-free (only React + Tailwind + lucide-react) and backend-agnostic.

## Foundations

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant` (primary/secondary/ghost/danger/outline), `size` (xs/sm/md), `loading`, `icon`, + native button | `loading` swaps icon for a spinner and disables |
| `IconButton` | `label` (required → title+aria), `tone` (default/danger), + native | square glyph button; `label` is the a11y name |
| `Card` / `CardHeader` / `CardBody` | header: `title`, `subtitle`, `actions` | the universal panel; header title accepts ReactNode |
| `Badge` | `tone` (Tone), `dot`, `pulse`, children | pill status chip |
| `StatusDot` | `tone`, `pulse`, `className` | bare dot for dense rows |
| `Tooltip` | `content`, `side` (top/bottom/left/right), `delay` | shows on hover **and** keyboard focus |

## Form controls

| Component | Props | Notes |
|---|---|---|
| `Input` / `Textarea` | `label`, `hint`, `error` (string|null), `required`, + native | `error` renders red border + `role=alert` message |
| `Select` | `options: {value,label}[]`, `placeholder`, `label/hint/error`, + native | custom chevron, same validation shell |
| `FieldShell` | `label`, `hint`, `error`, `required`, `children(id,describedBy)` | the shared a11y wrapper (auto `useId`, `aria-describedby`) |
| `Toggle` | `checked`, `onChange(v)`, `disabled`, `label`, `size` | `role=switch` + `aria-checked` |
| `Checkbox` | `checked`, `onChange(v)`, `label`, `disabled` | |

## Overlays & navigation

| Component | Props | Notes |
|---|---|---|
| `Modal` | `open`, `onClose`, `title`, `subtitle`, `footer`, `size` | portal; **Esc + backdrop close**; autofocuses first field |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel`, `danger`, `onConfirm`, `onCancel` | built on Modal |
| `Menu` / `MenuItem` | `trigger`, `triggerLabel`, `items`, `align` | accessible dropdown (Enter/Space/Esc/arrows) |
| `Tabs` | `tabs: {id,label,badge}[]`, `active`, `onChange`, `variant` | `role=tablist`, ArrowLeft/Right roving focus |

## Feedback

| Component | Props | Notes |
|---|---|---|
| `Toast` / `useToast()` / `ToastProvider` | `toast(message, kind)` kind: success/warning/error/info | portal stack, auto-dismiss ~3.2s, `aria-live` |
| `EmptyState` | `icon`, `title`, `description`, `action` | honest "nothing here" view |
| `LoadingState` | `label` | spinner row |
| `ErrorState` | `message`, `onRetry` | warn icon + retry (simulated) |
| `SkeletonBlock` | `className` | shimmer placeholder |
| `DemoNotice` | `text`, `className` | violet "prototype data" banner — honesty layer |

## Data viz (no chart library)

| Component | Props | Notes |
|---|---|---|
| `Meter` | `label`, `value` 0–100, `detail`, `tone` (`auto` picks warn/err by load) | labeled progress bar, `role=progressbar` |
| `Progress` | `value`, `tone` | bare bar |
| `Sparkline` | `values: number[]`, `tone`, `width`, `height` | pure inline SVG area+line |

## Layout & page chrome

| Component | Location | Props |
|---|---|---|
| `AppShell` | `components/layout` | Sidebar + Topbar + `<Outlet/>`; hosts `PlatformProvider` |
| `Sidebar` | `components/layout` | `NAV_ITEMS` source of truth; collapsible via `usePlatform` |
| `Topbar` | `components/layout` | page title (route-aware), active-model chip → `/models`, online/offline + theme toggles |
| `PageHeader` | `components/common/PageChrome` | `title`, `description`, `actions`, `notice`, `children` |
| `WorkArea` | `components/common/PageChrome` | `children`, `contextPanel` (right rail, ≥xl), `fill` for full-height |
| `ContextPanelCard` | `components/common/PageChrome` | `title`, `actions`, children |
| `KeyValue` | `components/common/PageChrome` | `k`, `v`, `mono` |
| `Logo` | `components/common` | `size`, `className`; inline SVG, unique gradient id |

## State & utilities

- `usePlatform()` → `activeModelId`, `setActiveModelId`, `online`, `setOnline`,
  `sidebarCollapsed`, `toggleSidebar`.
- `useActiveModel()` → current `ModelRecord` from `MOCK_MODELS`.
- `useTheme()` → `theme`, `setTheme`, `toggleTheme` (localStorage-persisted, dark default).
- `useDebouncedValue(v, ms)` and `useLocalFlag(key, initial)` in `src/lib/hooks`.
- `cn`, `formatBytes`, `timeAgo`, `clockTime`, `pct`, `seededNoise` in `src/lib/utils`.
- `Markdown` + `CodeBlock` in `src/lib/markdown` — a dependency-free renderer for
  chat output (headings, lists, bold/italic, inline + fenced code with copy).

## Accessibility baseline

Semantic buttons everywhere, `role`/`aria-*` on switches, tabs, menus, progress,
dialogs and live regions; global `:focus-visible` outline; Esc closes overlays;
arrow-key tab navigation; inputs labelled via `FieldShell`. Keyboard shortcuts:
`Enter` send / `Shift+Enter` newline in chat.
