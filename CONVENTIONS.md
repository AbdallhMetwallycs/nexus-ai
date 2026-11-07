> Internal build reference for the NEXUS AI Phase 1 UI. Not user-facing docs.

# NEXUS AI — Frontend conventions (READ FULLY before writing a screen)

## Hard rules (Phase 1)
- UI ONLY. No backend, no real AI, no model runtime, no network, no persistence beyond React state + localStorage flags.
- All content is mock data from `src/data/*`. Render it faithfully; never imply a real system is running.
- Put `<DemoNotice />` near the top of every screen that shows fabricated data/telemetry.
- Every button/control must do something real IN THE PROTOTYPE: change local state, open a Modal, fire a toast, toggle, filter, select. NO dead buttons that only look active.
- Forms need validation (disable submit / inline `error` until valid).
- Search + filters must actually operate on the mock arrays.
- Provide empty / loading / error states where they add value; use tooltips on technical controls.
- Desktop-first, must not overflow horizontally at 1280x720.
- TypeScript is STRICT and the build enables `noUnusedLocals` and `noUnusedParameters`. Every import you add MUST be used, or `tsc` fails.
- Do NOT edit shared files: `src/components/ui/*`, `src/components/common/*`, `src/components/layout/*`, `src/data/*`, `src/state/*`, `src/lib/*`, `src/App.tsx`, `src/main.tsx`. Only write the page files assigned to you. If you need a tiny local subcomponent, define it inside your page file.
- Icons: only `lucide-react`, imported by name.

## Imports available to you
UI barrel — `import { ... } from '../components/ui';`
- `Button` { variant: 'primary'|'secondary'|'ghost'|'danger'|'outline' = 'secondary'; size: 'xs'|'sm'|'md' = 'sm'; loading?; icon?: ReactNode; ...button props }
- `IconButton` { label: string (required; sets title+aria); tone?: 'default'|'danger'; ...button props } (children = an icon)
- `Card` (div) · `CardHeader` { title: ReactNode; subtitle?; actions? } · `CardBody` (padded div)
- `Badge` { tone?: Tone; dot?: boolean; pulse?: boolean } · `StatusDot` { tone?: Tone; pulse?; className? }
  - `type Tone = 'ok'|'warn'|'err'|'info'|'idle'|'accent'|'violet'`
- `Modal` { open; onClose; title?; subtitle?; footer?: ReactNode; size?: 'sm'|'md'|'lg'|'xl' = 'md' } (Esc + backdrop close built in)
- `ConfirmDialog` { open; title; message: ReactNode; confirmLabel?; danger?; onConfirm; onCancel }
- `Input` { label?; hint?; error?: string|null; ...input props } · `Textarea` (same + rows) · `Select` { label?; hint?; error?; options: {value,label}[]; placeholder?; ...select props }
- `Toggle` { checked; onChange(v:boolean); disabled?; label?; size?: 'sm'|'md' } · `Checkbox` { checked; onChange(v); label?; disabled? }
- `Tabs` { tabs: {id; label: ReactNode; badge?}[]; active; onChange(id); variant?: 'underline'|'pill' } (arrow-key nav built in)
- `Tooltip` { content: ReactNode; side?: 'top'|'bottom'|'left'|'right'; delay? } (wrap any control)
- `Menu` { trigger: ReactNode; triggerLabel: string; items: MenuItem[]; align?: 'left'|'right' } where `MenuItem = { id; label: ReactNode; icon?: ReactNode; danger?; disabled?; onSelect() }`
- `SearchInput` { value; onChange(v:string); placeholder?; className? }
- `EmptyState` { icon?: ReactNode; title; description?; action? } · `LoadingState` { label? } · `ErrorState` { message?; onRetry? }
- `Meter` { label; value:0..100; detail?; tone?: 'auto'|Tone } · `Progress` { value; tone? } · `Sparkline` { values:number[]; tone? }
- `DemoNotice` { text?; className? }
- `useToast()` → `{ toast(message:string, kind?: 'success'|'warning'|'error'|'info') }`

Page chrome — `import { PageHeader, WorkArea, ContextPanelCard, KeyValue } from '../components/common/PageChrome';`
- `PageHeader` { title; description?; actions?: ReactNode; notice?: ReactNode; children? } — usually as first child of WorkArea content.
- `WorkArea` { children; contextPanel?: ReactNode; className?; fill?: boolean } — the right rail (contextPanel) shows only on ≥xl. Use `fill` for full-height layouts (chat-style).
- `ContextPanelCard` { title; actions?; children } · `KeyValue` { k: string; v: ReactNode; mono?: boolean }

Utils — `import { cn, formatBytes, timeAgo, clockTime, pct } from '../lib/utils';`
Hooks — `import { useDebouncedValue } from '../lib/hooks';`

State — `import { usePlatform, useActiveModel } from '../state/PlatformContext';` → `{ activeModelId, setActiveModelId, online, setOnline, sidebarCollapsed, toggleSidebar }`; `useActiveModel()` returns the active `ModelRecord`.

## Tailwind tokens (already configured)
Colors: `bg-surface-base|raised|overlay`, `border-surface-line`, `text-ink-primary|secondary|muted|faint`, `text-accent|violet`, `bg-state-ok|warn|err|info|idle`.
Classes: `.card .field .label .mono-num .skeleton`. Shadows `shadow-card|pop|glow`. Radius `rounded-card|field`. Anim `animate-fade-in|slide-up|pulse-dot`.
Layout is flex/grid; the app shell already provides scrolling — pages scroll naturally inside WorkArea.

## Page skeleton pattern
```tsx
import { PageHeader, WorkArea } from '../components/common/PageChrome';
import { DemoNotice, /* … */ } from '../components/ui';
export default function X() {
  return (
    <WorkArea contextPanel={/* optional right rail cards */}>
      <PageHeader title="…" description="…" notice={<DemoNotice />} actions={<Button …>…</Button>} />
      <div className="p-5 space-y-5">{/* grid of Cards */}</div>
    </WorkArea>
  );
}
```

## Reference implementations (copy their style, do not import them)
- `src/pages/Dashboard.tsx` — cards, meters, context rail, badges.
- `src/pages/Chat.tsx` — modals, menus, toasts, validation, full-height fill layout.

## Verify before returning
Run: `npx tsc --noEmit 2>&1 | grep -E "pages/(YOUR_FILES)"` — fix every reported line. If grep prints nothing, your files are clean. Do not report success until this passes.
