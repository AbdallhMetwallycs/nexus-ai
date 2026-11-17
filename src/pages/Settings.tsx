import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  Check,
  Cpu,
  Download,
  Globe,
  HardDrive,
  Info,
  Languages,
  Lock,
  Package,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DemoNotice,
  Input,
  LoadingState,
  Modal,
  Select,
  StatusDot,
  Toggle,
  Tooltip,
  useToast,
} from '../components/ui';
import { KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { Logo } from '../components/common/Logo';
import { MOCK_AGENTS } from '../data/agents';
import { MOCK_MODELS, modelName } from '../data/models';
import { HARDWARE_PROFILE } from '../data/hardware';
import { INTERNET_PERMISSION_DEFAULTS } from '../data/internet';
import { usePlatform } from '../state/PlatformContext';
import { useTheme } from '../theme/ThemeContext';
import { cn, formatBytes } from '../lib/utils';
import { resolveTransport } from '../contract/client';
import type { BackupRecord, SettingsSectionId, SettingValue } from '../contract/ipc';

/** The desktop build has a real core behind it; the browser build is a demo. */
function useLive() {
  const transport = useMemo(() => resolveTransport(), []);
  return { transport, live: transport.kind === 'tauri' };
}

/** Bytes → the GB form `formatBytes` expects. */
function bytesToGB(bytes: number): number {
  return bytes / 1024 ** 3;
}

/* ------------------------------------------------------------------ */
/* Shared page-local machinery: dirty-tracked section state            */
/* ------------------------------------------------------------------ */

/**
 * Section values live in component state and, in the desktop build, in the local
 * database. Saving with a `section` calls `settings.patch`; the browser demo says
 * plainly that the save lasted only for this tab.
 */
function useSection<T extends object>(initial: T, section?: SettingsSectionId) {
  const { toast } = useToast();
  const { transport, live } = useLive();
  const [saved, setSaved] = useState<T>(initial);
  const [values, setValues] = useState<T>(initial);
  const [loaded, setLoaded] = useState(!live || !section);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const patch = (p: Partial<T>) => setValues((prev) => ({ ...prev, ...p }));

  // Load what the owner saved before, once per mount.
  useEffect(() => {
    if (!live || !section) return;
    let cancelled = false;
    void (async () => {
      const res = await transport.call('settings.get');
      if (cancelled) return;
      if (res.ok) {
        const stored = res.data.sections[section] ?? {};
        const merged = { ...initial } as T;
        for (const key of Object.keys(initial) as (keyof T)[]) {
          const value = stored[key as string];
          if (typeof value === typeof initial[key]) merged[key] = value as T[keyof T];
        }
        setSaved(merged);
        setValues(merged);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // `initial` is a per-section literal; reloading on every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!live || !section) {
      setSaved(values);
      toast(
        live ? 'Preference saved for this screen only' : 'Preference saved in this browser session only',
        'success',
      );
      return;
    }
    void (async () => {
      const res = await transport.call('settings.patch', {
        section,
        values: values as unknown as Record<string, SettingValue>,
      });
      if (!res.ok) {
        toast(`${res.error.code}: ${res.error.message}`, 'error');
        return;
      }
      setSaved(values);
      toast('Preference saved to the local database', 'success');
    })();
  };

  const discard = () => setValues(saved);
  return { values, saved, patch, dirty, save, discard, loaded };
}

function DirtyFooter({
  dirty,
  onSave,
  onDiscard,
  invalid,
  invalidMsg,
}: {
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  invalid?: boolean;
  invalidMsg?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-surface-line bg-surface-overlay/95 px-4 py-3 shadow-pop backdrop-blur">
      <p className="min-w-0 text-xs text-ink-muted">
        <span className="font-semibold text-ink-primary">Unsaved changes</span>
        <span className="text-ink-faint"> — stored in this session only, never on disk.</span>
        {invalid && invalidMsg && <span className="ml-2 font-medium text-state-err">{invalidMsg}</span>}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="primary" disabled={invalid} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  desc,
  tip,
  children,
}: {
  label: string;
  desc: string;
  tip: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-primary">{label}</p>
        <p className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{desc}</p>
      </div>
      <Tooltip content={tip} side="left">
        <span className="shrink-0 pt-0.5">{children}</span>
      </Tooltip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation model                                                    */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'language', label: 'Language', icon: Languages },
  { id: 'hardware', label: 'Hardware', icon: Cpu },
  { id: 'models', label: 'Models', icon: Boxes },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'internet', label: 'Internet', icon: Globe },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'backup', label: 'Backup', icon: HardDrive },
  { id: 'portability', label: 'Portability', icon: Package },
  { id: 'about', label: 'About', icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const [section, setSection] = useState<SectionId>('general');
  const { live } = useLive();

  return (
    <WorkArea>
      <PageHeader
        title="Settings"
        description={
          live
            ? 'All platform preferences in one place. Theme, font scale and the active model apply immediately; saved sections are written to the local database.'
            : 'All platform preferences in one place. Real frontend effects (theme, font scale, active model) apply immediately; everything else is honest prototype state.'
        }
        notice={
          live ? undefined : (
            <DemoNotice text="Saving a preference writes to React state only — no registry, no config file, no network." />
          )
        }
      />
      <div className="flex gap-5 p-5">
        {/* Sub-navigation (local state, not routes) */}
        <nav aria-label="Settings sections" className="w-[190px] shrink-0 space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-field px-3 py-2 text-left text-xs font-medium transition-colors',
                  active
                    ? 'bg-accent/10 text-ink-primary shadow-card'
                    : 'text-ink-muted hover:bg-surface-line/40 hover:text-ink-secondary',
                )}
              >
                <Icon size={14} className={active ? 'text-accent' : 'text-ink-faint'} />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
          {section === 'general' && <GeneralSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'language' && <LanguageSection />}
          {section === 'hardware' && <HardwareSection />}
          {section === 'models' && <ModelsSection />}
          {section === 'agents' && <AgentsSection />}
          {section === 'memory' && <MemorySection />}
          {section === 'internet' && <InternetSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'backup' && <BackupSection />}
          {section === 'portability' && <PortabilitySection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </WorkArea>
  );
}

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [mode, setMode] = useState<'light' | 'dark' | 'system'>(theme);
  const s = useSection({ startPage: 'dashboard', autoStart: false, density: 'comfortable' }, 'general');

  const pickMode = (m: 'light' | 'dark' | 'system') => {
    setMode(m);
    if (m === 'system') {
      toast('System auto-switching is not implemented — keeping the current theme', 'info');
    } else {
      setTheme(m);
    }
  };

  return (
    <>
      <Card>
        <CardHeader title="Startup & behaviour" subtitle="How NEXUS launches and where it lands" />
        <CardBody className="pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="App start page"
              value={s.values.startPage}
              onChange={(e) => s.patch({ startPage: e.target.value })}
              options={[
                { value: 'dashboard', label: 'Dashboard' },
                { value: 'chat', label: 'Chat' },
                { value: 'agents', label: 'Agents' },
                { value: 'models', label: 'Model Manager' },
              ]}
              hint="Would open after launch once startup behaviour is wired — this value is saved but not yet acted on."
            />
            <Select
              label="Interface density"
              value={s.values.density}
              onChange={(e) => s.patch({ density: e.target.value })}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
              hint="Prototype setting — it maps onto the spacing scale once design tokens support density."
            />
          </div>
          <div className="mt-3 divide-y divide-surface-line">
            <SettingRow
              label="Start with Windows"
              desc="Launch NEXUS silently at sign-in."
              tip="Phase 1 cannot touch the registry — toggling only shows what the flow will look like."
            >
              <Toggle
                checked={s.values.autoStart}
                onChange={(v) => {
                  s.patch({ autoStart: v });
                  toast('registry changes disabled in Phase 1', 'warning');
                }}
                label="Start with Windows"
              />
            </SettingRow>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Theme"
          subtitle="Real effect — this switch changes the whole app right now (dark is the default)"
        />
        <CardBody className="pt-2">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color theme">
            {(
              [
                { id: 'light', label: 'Light' },
                { id: 'dark', label: 'Dark' },
                { id: 'system', label: 'System' },
              ] as const
            ).map((o) => (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-field border px-3 py-2 text-xs font-medium',
                  mode === o.id
                    ? 'border-accent/50 bg-accent/10 text-ink-primary'
                    : 'border-surface-line bg-surface-raised text-ink-muted hover:text-ink-secondary',
                )}
              >
                <input
                  type="radio"
                  name="theme-mode"
                  checked={mode === o.id}
                  onChange={() => pickMode(o.id)}
                  className="h-3.5 w-3.5 accent-[#0284C7]"
                />
                {o.label}
                {o.id === 'system' && mode === 'system' && <Badge tone="idle">Phase 2</Badge>}
              </label>
            ))}
          </div>
          <p className="mt-2 text-2xs text-ink-faint">
            System mode follows the OS preference in Phase 2 — selecting it here keeps your last manual choice.
          </p>
        </CardBody>
      </Card>

      <DirtyFooter dirty={s.dirty} onSave={s.save} onDiscard={s.discard} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

const THEME_PREVIEWS = [
  {
    id: 'dark' as const,
    label: 'Dark',
    bg: '#0B0F17',
    card: '#141A24',
    line: '#38BDF8',
    bars: ['#334155', '#475569'],
  },
  {
    id: 'light' as const,
    label: 'Light',
    bg: '#F1F5F9',
    card: '#FFFFFF',
    line: '#0284C7',
    bars: ['#CBD5E1', '#94A3B8'],
  },
];

function applyFontScale(v: number) {
  document.documentElement.style.setProperty('--nexus-font-scale', String(v));
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const s = useSection({ fontScale: 1 }, 'appearance');

  const setScale = (v: number) => {
    s.patch({ fontScale: v });
    applyFontScale(v);
  };

  return (
    <>
      <Card>
        <CardHeader title="Theme" subtitle="Applies instantly across the app — a real frontend behavior" />
        <CardBody className="pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {THEME_PREVIEWS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={theme === t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'rounded-card border p-3 text-left transition-colors',
                  theme === t.id
                    ? 'border-accent/50 bg-accent/10 shadow-glow'
                    : 'border-surface-line bg-surface-raised hover:border-ink-faint/40',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink-primary">{t.label}</span>
                  {theme === t.id && <Badge tone="ok" dot>active</Badge>}
                </span>
                <span
                  className="mt-2 block overflow-hidden rounded-md border border-surface-line p-2"
                  style={{ background: t.bg }}
                  aria-hidden
                >
                  <span className="block h-1.5 w-2/3 rounded-full" style={{ background: t.line }} />
                  <span className="mt-1.5 block rounded-md p-1.5" style={{ background: t.card }}>
                    <span className="block h-1 w-4/5 rounded-full" style={{ background: t.bars[0] }} />
                    <span className="mt-1 block h-1 w-3/5 rounded-full" style={{ background: t.bars[1] }} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Accent color" subtitle="Only the Sky/cyan identity ships in Phase 1" />
        <CardBody className="pt-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-field border border-accent/50 bg-accent/10 px-3 py-2 text-xs font-medium text-ink-primary"
              onClick={() => toast('Sky/cyan is the only tokenised accent in Phase 1', 'info')}
            >
              <span className="h-3 w-3 rounded-full bg-accent" /> Sky / cyan
              <Badge tone="ok" dot>in use</Badge>
            </button>
            {(['Violet', 'Emerald', 'Amber'] as const).map((c) => (
              <Tooltip key={c} content={`Accent "${c}" is designed but not tokenised yet`} side="top">
                <button
                  type="button"
                  disabled
                  className="flex items-center gap-2 rounded-field border border-surface-line bg-surface-raised px-3 py-2 text-xs font-medium text-ink-faint opacity-60"
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: c === 'Violet' ? '#7C3AED' : c === 'Emerald' ? '#34D399' : '#FBBF24' }}
                  />
                  {c}
                  <Badge tone="idle">planned</Badge>
                </button>
              </Tooltip>
            ))}
          </div>
          <p className="mt-2 text-2xs text-ink-faint">Additional accents ship with the theming engine in Phase 2.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Font scale" subtitle="Real effect — rescales the UI text through a CSS variable" />
        <CardBody className="pt-2">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="font-scale" className="label mb-0">
                  Scale
                </label>
                <span className="mono-num text-xs text-ink-secondary">{Math.round(s.values.fontScale * 100)}%</span>
              </div>
              <input
                id="font-scale"
                type="range"
                min={0.85}
                max={1.3}
                step={0.05}
                value={s.values.fontScale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="mt-1 w-full max-w-sm accent-[#0284C7]"
              />
              <p className="mt-1 text-2xs text-ink-faint">
                Sets <span className="mono-num">--nexus-font-scale</span> on the document root and drives the sample
                below.
              </p>
            </div>
            <div className="rounded-card border border-surface-line bg-surface-base p-4">
              <p className="font-semibold text-ink-primary" style={{ fontSize: `${15 * s.values.fontScale}px` }}>
                NEXUS AI — Local Agent Platform
              </p>
              <p className="mt-1 text-ink-secondary" style={{ fontSize: `${12.5 * s.values.fontScale}px` }}>
                The quick brown fox jumps over the lazy dog while the Research Agent cites three local documents and
                never touches the network.
              </p>
              <p className="mono-num mt-1 text-ink-faint" style={{ fontSize: `${11 * s.values.fontScale}px` }}>
                0123456789 · mono-num sample
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <DirtyFooter
        dirty={s.dirty}
        onSave={s.save}
        onDiscard={() => {
          s.discard();
          applyFontScale(s.saved.fontScale);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Language                                                            */
/* ------------------------------------------------------------------ */

const LANGUAGES: { value: string; label: string; greeting: string }[] = [
  { value: 'en', label: 'English', greeting: 'Hello, welcome back to NEXUS.' },
  { value: 'ar', label: 'العربية (Arabic)', greeting: 'مرحباً بعودتك إلى NEXUS.' },
  { value: 'de', label: 'Deutsch (German)', greeting: 'Hallo, willkommen zurück bei NEXUS.' },
  { value: 'fr', label: 'Français (French)', greeting: 'Bonjour, bon retour sur NEXUS.' },
  { value: 'es', label: 'Español (Spanish)', greeting: 'Hola, bienvenido de nuevo a NEXUS.' },
];

function LanguageSection() {
  const { toast } = useToast();
  const s = useSection({ language: 'en' }, 'language');
  const current = LANGUAGES.find((l) => l.value === s.values.language) ?? LANGUAGES[0];

  return (
    <>
      <Card>
        <CardHeader title="Interface language" subtitle="Phase 1 ships English only — this previews the selection flow" />
        <CardBody className="pt-2">
          <div className="space-y-4">
            <Select
              label="Language"
              value={s.values.language}
              onChange={(e) => {
                s.patch({ language: e.target.value });
                toast('UI translation ships with Phase 2', 'info');
              }}
              options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
              hint="Only the sample greeting below actually changes today."
            />
            <div className="rounded-card border border-surface-line bg-surface-base p-4">
              <p className="label mb-1">Sample</p>
              <p className="text-sm text-ink-primary" dir={current.value === 'ar' ? 'rtl' : 'ltr'}>
                {current.greeting}
              </p>
              {current.value === 'ar' && (
                <p className="mt-2">
                  <Badge tone="idle">full RTL layout is not implemented yet</Badge>
                </p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
      <DirtyFooter dirty={s.dirty} onSave={s.save} onDiscard={s.discard} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Hardware                                                            */
/* ------------------------------------------------------------------ */

function HardwareSection() {
  const s = useSection({ ramFloor: '4', gpuOffload: false, power: 'balanced' }, 'hardware');
  const ramNum = Number(s.values.ramFloor);
  const ramInvalid = s.values.ramFloor.trim() === '' || Number.isNaN(ramNum) || ramNum < 1 || ramNum > 32;

  return (
    <>
      <Card>
        <CardHeader title="Reference machine (read-only)" subtitle="Static profile — Phase 1 has no sensor access" />
        <CardBody className="pt-2">
          <DemoNotice text="Values below are the mock profile used by Dashboard and Model Manager." />
          <div className="mt-2 space-y-0.5">
            <KeyValue k="CPU" v={HARDWARE_PROFILE.cpu} />
            <KeyValue k="GPU" v={HARDWARE_PROFILE.gpu} />
            <KeyValue k="RAM" v={`${HARDWARE_PROFILE.ramTotalGB} GB total`} mono />
            <KeyValue
              k="Storage (D:)"
              v={`${HARDWARE_PROFILE.storageTotalGB} GB · ${HARDWARE_PROFILE.storageFreeGB} GB free`}
              mono
            />
            <KeyValue k="OS" v={HARDWARE_PROFILE.os} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Resource policy" subtitle="Guardrails the engine will respect in Phase 2" />
        <CardBody className="pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="RAM reserve floor (GB)"
              type="number"
              min={1}
              max={32}
              value={s.values.ramFloor}
              onChange={(e) => s.patch({ ramFloor: e.target.value })}
              error={ramInvalid ? 'Enter a whole number between 1 and 32.' : null}
              hint="NEXUS will refuse to load models that would push free RAM below this level (reserve)."
            />
            <Select
              label="Power profile"
              value={s.values.power}
              onChange={(e) => s.patch({ power: e.target.value })}
              options={[
                { value: 'balanced', label: 'Balanced' },
                { value: 'performance', label: 'Best performance' },
                { value: 'battery', label: 'Battery saver' },
              ]}
              hint="Would cap inference threads on this 15 W CPU."
            />
          </div>
          <div className="mt-2 divide-y divide-surface-line">
            <SettingRow
              label="GPU offload"
              desc="Push eligible layers to the MX150 when it is free."
              tip="No GPU runtime exists in Phase 1 — this stores intent for the future inference scheduler."
            >
              <Toggle checked={s.values.gpuOffload} onChange={(v) => s.patch({ gpuOffload: v })} label="GPU offload" />
            </SettingRow>
          </div>
        </CardBody>
      </Card>

      <DirtyFooter
        dirty={s.dirty}
        onSave={s.save}
        onDiscard={s.discard}
        invalid={ramInvalid}
        invalidMsg="Fix the RAM floor before saving."
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

function ModelsSection() {
  const { toast } = useToast();
  const { activeModelId, setActiveModelId } = usePlatform();
  const s = useSection({ preferQuant: true, maxConcurrent: '2' }, 'models');
  const maxNum = Number(s.values.maxConcurrent);
  const maxInvalid = s.values.maxConcurrent.trim() === '' || Number.isNaN(maxNum) || maxNum < 1 || maxNum > 8;

  return (
    <>
      <Card>
        <CardHeader
          title="Default model"
          subtitle="Real cross-screen effect — the topbar chip, Dashboard and Chat follow this choice"
        />
        <CardBody className="pt-2">
          <Select
            label="Active model"
            value={activeModelId}
            onChange={(e) => {
              setActiveModelId(e.target.value);
              toast(`${modelName(e.target.value)} is now the active model on every screen`, 'success');
            }}
            options={MOCK_MODELS.map((m) => ({ value: m.id, label: m.name }))}
            hint="Selection only — no weights are loaded in Phase 1."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Inference policy" subtitle="Stored for the future local engine" />
        <CardBody className="pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Max concurrent inferences"
              type="number"
              min={1}
              max={8}
              value={s.values.maxConcurrent}
              onChange={(e) => s.patch({ maxConcurrent: e.target.value })}
              error={maxInvalid ? 'Enter a number between 1 and 8.' : null}
              hint="On 20 GB RAM, one at a time is usually the honest answer."
            />
          </div>
          <div className="mt-2 divide-y divide-surface-line">
            <SettingRow
              label="Prefer smaller quantization"
              desc="Choose Q4 over Q5/Q6 when quality deltas are marginal."
              tip="Quantization preference for the downloader in Phase 2 — keeps memory pressure low on this machine."
            >
              <Toggle checked={s.values.preferQuant} onChange={(v) => s.patch({ preferQuant: v })} label="Prefer smaller quant" />
            </SettingRow>
          </div>
        </CardBody>
      </Card>

      <DirtyFooter
        dirty={s.dirty}
        onSave={s.save}
        onDiscard={s.discard}
        invalid={maxInvalid}
        invalidMsg="Fix the concurrency limit before saving."
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

interface AgentRow {
  id: string;
  name: string;
  role: string;
  enabled: boolean;
  modelId: string;
}

const AGENT_INITIAL: AgentRow[] = MOCK_AGENTS.map((a) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  enabled: a.enabled,
  modelId: a.modelId,
}));

function AgentsSection() {
  const { toast } = useToast();
  const [saved, setSaved] = useState<AgentRow[]>(AGENT_INITIAL);
  const [rows, setRows] = useState<AgentRow[]>(AGENT_INITIAL);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const patchRow = (id: string, p: Partial<AgentRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  return (
    <>
      <Card>
        <CardHeader
          title="Agents"
          subtitle="Enable/disable and assign a default model per agent — this screen is still simulated; agent execution is an M3+ milestone"
        />
        <CardBody className="pt-1">
          <ul className="divide-y divide-surface-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-xs font-semibold text-ink-primary">
                    <StatusDot tone={r.enabled ? 'ok' : 'idle'} />
                    {r.name}
                  </p>
                  <p className="text-2xs text-ink-faint">{r.role}</p>
                </div>
                <Select
                  aria-label={`Default model for ${r.name}`}
                  className="h-8 w-[220px] text-xs"
                  value={r.modelId}
                  onChange={(e) => patchRow(r.id, { modelId: e.target.value })}
                  options={MOCK_MODELS.map((m) => ({ value: m.id, label: m.name }))}
                />
                <Tooltip content={`Turn ${r.name} ${r.enabled ? 'off' : 'on'} (frontend state only)`} side="left">
                  <Toggle
                    checked={r.enabled}
                    onChange={(v) => patchRow(r.id, { enabled: v })}
                    label={`Enable ${r.name}`}
                    size="sm"
                  />
                </Tooltip>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-ink-faint">
            Disabled agents would be hidden from the agent picker and refuse delegation in Phase 2.
          </p>
        </CardBody>
      </Card>
      <DirtyFooter
        dirty={dirty}
        onSave={() => {
          setSaved(rows);
          toast('Saved for this screen only — agent config is not persisted yet', 'success');
        }}
        onDiscard={() => setRows(saved)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

function MemorySection() {
  const { toast } = useToast();
  const { transport, live } = useLive();
  const s = useSection({ autoCapture: true, requireApproval: true, retention: '30' }, 'memory');
  const [purgeOpen, setPurgeOpen] = useState(false);

  const purge = () => {
    setPurgeOpen(false);
    if (!live) {
      toast('Nothing to purge — the browser demo keeps memory in React state only', 'info');
      return;
    }
    void (async () => {
      const res = await transport.call('store.purge', { kind: 'short_term_memory' });
      if (!res.ok) {
        toast(`${res.error.code}: ${res.error.message}`, 'error');
        return;
      }
      const { removed, freedBytes } = res.data;
      toast(
        removed === 0
          ? 'No short-term records were older than the retention window; nothing was deleted'
          : `Removed ${removed} short-term record${removed === 1 ? '' : 's'} and freed ${formatBytes(bytesToGB(freedBytes))}`,
        'success',
      );
    })();
  };

  return (
    <>
      <Card>
        <CardHeader title="Memory capture" subtitle="What the assistant may remember between sessions" />
        <CardBody className="pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Short-term retention"
              value={s.values.retention}
              onChange={(e) => s.patch({ retention: e.target.value })}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' },
                { value: '365', label: '365 days' },
                { value: 'never', label: 'Keep forever' },
              ]}
              hint={
                live
                  ? 'Saved as a preference. The purge below uses the store’s fixed windows (short tier: 1 day, archived: 30 days) until M3 wires this value in.'
                  : 'Applies to short-tier memories only; long-term records never expire automatically.'
              }
            />
          </div>
          <div className="divide-y divide-surface-line">
            <SettingRow
              label="Auto-capture candidates"
              desc="Propose memory records from conversations automatically."
              tip="Captures become candidates — nothing is stored durably without approval."
            >
              <Toggle checked={s.values.autoCapture} onChange={(v) => s.patch({ autoCapture: v })} label="Auto-capture" />
            </SettingRow>
            <SettingRow
              label="Require approval before storing"
              desc="Every memory write needs your explicit confirmation."
              tip="Product principle: the model may propose, only you may persist. On by default and stays on."
            >
              <Toggle
                checked={s.values.requireApproval}
                onChange={(v) => {
                  s.patch({ requireApproval: v });
                  if (!v) toast('Approval-free writes weaken a core privacy principle', 'warning');
                }}
                label="Require approval before storing"
              />
            </SettingRow>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Danger zone"
          subtitle={live ? 'Deletes rows from the local database — there is no undo' : 'Short-term memory lives in prototype state only'}
        />
        <CardBody className="pt-2">
          <Button variant="danger" onClick={() => setPurgeOpen(true)}>
            Purge short-term memory
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={purgeOpen}
        title="Purge short-term memory?"
        message={
          live
            ? 'Deletes every short-tier memory row older than one day and every archived row older than 30 days from the local database, then vacuums the file. This cannot be undone.'
            : 'The browser demo keeps memory in React state; there is nothing to delete.'
        }
        confirmLabel={live ? 'Purge' : 'Purge (simulated)'}
        danger
        onCancel={() => setPurgeOpen(false)}
        onConfirm={purge}
      />

      <DirtyFooter dirty={s.dirty} onSave={s.save} onDiscard={s.discard} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Internet (read-only mirror)                                         */
/* ------------------------------------------------------------------ */

function InternetSection() {
  const navigate = useNavigate();
  const { online } = usePlatform();
  const mirror = [
    { label: 'Offline by default', on: INTERNET_PERMISSION_DEFAULTS.offlineByDefault },
    { label: 'Per-agent internet control', on: INTERNET_PERMISSION_DEFAULTS.perAgentControl },
    { label: 'Ask per request', on: INTERNET_PERMISSION_DEFAULTS.perRequestPrompt },
    { label: 'Allow-list only', on: INTERNET_PERMISSION_DEFAULTS.allowListOnly },
    { label: 'Never send full context', on: !INTERNET_PERMISSION_DEFAULTS.sendFullContext },
    { label: 'Block uploads of private docs', on: INTERNET_PERMISSION_DEFAULTS.blockUploadsOfPrivateDocs },
  ];

  return (
    <Card>
      <CardHeader
        title="Internet policy"
        subtitle="Read-only summary — edit the real switches in Internet Center"
        actions={<StatusDot tone={online ? 'ok' : 'info'} pulse={online} />}
      />
      <CardBody className="pt-2">
        <div className="divide-y divide-surface-line">
          {mirror.map((m) => (
            <div key={m.label} className="flex items-center justify-between gap-3 py-2">
              <span className="text-xs text-ink-secondary">{m.label}</span>
              <Badge tone={m.on ? 'ok' : 'idle'}>{m.on ? 'On' : 'Off'}</Badge>
            </div>
          ))}
        </div>
        <p className="mt-2 text-2xs text-ink-faint">
          Current mode: <strong className="text-ink-secondary">{online ? 'Online (simulated)' : 'Offline'}</strong>.
          Defaults shown here come from the shared policy dataset.
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          icon={<ArrowRight size={13} />}
          onClick={() => navigate('/internet')}
        >
          Open Internet Center
        </Button>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

const APPROVAL_OPERATIONS = [
  'Shell / PowerShell commands that change system state',
  'File deletion or writes outside the workspace',
  'Any upload of local documents to a URL',
  'Installing or enabling new tools and skills',
  'Memory writes that touch preferences or credentials',
];

function SecuritySection() {
  const s = useSection({ redact: true }, 'security');

  return (
    <>
      <Card>
        <CardHeader title="Approval-required operations" subtitle="Always gated — the engine cannot bypass this list" />
        <CardBody className="pt-1">
          <ul className="space-y-1.5">
            {APPROVAL_OPERATIONS.map((op) => (
              <li key={op} className="flex items-start gap-2 text-xs text-ink-secondary">
                <Check size={13} className="mt-0.5 shrink-0 text-state-ok" />
                {op}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-ink-faint">Static checklist — approval prompts are not implemented, so nothing here is enforced yet.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Context safety" />
        <CardBody className="pt-2">
          <div className="divide-y divide-surface-line">
            <SettingRow
              label="Redact sensitive fields before context"
              desc="Strip tokens, IDs and key-like strings before anything reaches the model."
              tip="Redaction happens locally, before inference — the model never sees the raw value."
            >
              <Toggle checked={s.values.redact} onChange={(v) => s.patch({ redact: v })} label="Redact sensitive fields" />
            </SettingRow>
          </div>
          <div className="mt-3 space-y-0.5 rounded-card border border-surface-line bg-surface-base p-3">
            <KeyValue k="Secret storage" v="no secrets stored in Phase 1" />
            <KeyValue k="Keychain / vault" v="not wired (planned)" />
            <KeyValue k="Credential prompts" v="disabled while the vault is missing" />
          </div>
        </CardBody>
      </Card>

      <DirtyFooter dirty={s.dirty} onSave={s.save} onDiscard={s.discard} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

const DATA_ROWS = ['Conversations', 'Memories', 'Knowledge Base documents', 'Telemetry cache', 'Instruction files'];

function PrivacySection() {
  const { toast } = useToast();
  const { transport, live } = useLive();
  const s = useSection({ telemetry: false }, 'privacy');
  const [exporting, setExporting] = useState(false);

  const exportMyData = () => {
    if (!live) {
      toast('The browser demo has no database — there is nothing to export', 'info');
      return;
    }
    if (exporting) return;
    setExporting(true);
    void (async () => {
      const res = await transport.call('store.export', { format: 'json' });
      setExporting(false);
      if (!res.ok) {
        toast(`${res.error.code}: ${res.error.message}`, 'error');
        return;
      }
      toast(`Exported ${formatBytes(bytesToGB(res.data.bytes))} of owner data to ${res.data.path}`, 'success');
    })();
  };

  return (
    <>
      <Card>
        <CardHeader title="Data locality" subtitle="Where each class of data physically lives" />
        <CardBody className="pt-1">
          <ul className="divide-y divide-surface-line">
            {DATA_ROWS.map((r) => (
              <li key={r} className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-ink-secondary">{r}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-ink-primary">
                  <StatusDot tone={live ? 'ok' : 'idle'} /> {live ? 'Local database' : 'Browser session'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-ink-faint">
            {live
              ? 'Everything above is written to one SQLite file under %APPDATA%\\NexusAI on this machine. Indexed Knowledge Base documents and their chunks live in the same file.'
              : 'In this prototype "local" means React state in your browser tab — nothing is persisted to disk.'}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Telemetry" />
        <CardBody className="pt-2">
          <div className="divide-y divide-surface-line">
            <SettingRow
              label="Send usage analytics"
              desc={live ? 'Default OFF. No code path sends anything off this machine.' : 'Default OFF. none is sent anywhere; Phase 1 cannot send anything.'}
              tip="The switch exists to make the intent explicit: telemetry is opt-in, never on by default."
            >
              <Toggle checked={s.values.telemetry} onChange={(v) => s.patch({ telemetry: v })} label="Send usage analytics" />
            </SettingRow>
          </div>
          <Button
            variant="secondary"
            className="mt-3"
            icon={<Download size={13} />}
            loading={exporting}
            onClick={exportMyData}
          >
            Export my data
          </Button>
        </CardBody>
      </Card>

      <DirtyFooter dirty={s.dirty} onSave={s.save} onDiscard={s.discard} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

function BackupSection() {
  const { toast } = useToast();
  const { transport, live } = useLive();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(live);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<BackupRecord | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const loadBackups = async () => {
    const res = await transport.call('store.backups');
    if (!res.ok) {
      toast(`${res.error.code}: ${res.error.message}`, 'error');
      return;
    }
    setBackups(res.data);
    setLoading(false);
  };

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const res = await transport.call('store.backups');
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        toast(`${res.error.code}: ${res.error.message}`, 'error');
        return;
      }
      setBackups(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, transport, toast]);

  const createBackup = () => {
    if (!live) {
      toast('Creating a backup needs the desktop build; the browser demo has no database to copy', 'warning');
      return;
    }
    if (creating) return;
    setCreating(true);
    void (async () => {
      const res = await transport.call('store.backup');
      setCreating(false);
      if (!res.ok) {
        toast(`${res.error.code}: ${res.error.message}`, 'error');
        return;
      }
      const { path, bytes, verified } = res.data;
      toast(
        `${verified ? 'Backup written and integrity-checked' : 'Backup written (integrity check did not pass)'}: ${path} · ${formatBytes(bytesToGB(bytes))}`,
        verified ? 'success' : 'warning',
      );
      await loadBackups();
    })();
  };

  const restore = () => {
    const target = restoring;
    setRestoring(null);
    if (!target || restoreBusy) return;
    setRestoreBusy(true);
    void (async () => {
      const res = await transport.call('store.restore', { path: target.path });
      setRestoreBusy(false);
      if (!res.ok) {
        toast(`${res.error.code}: ${res.error.message}`, 'error');
        return;
      }
      toast(`Restored ${target.name}. The replaced state was saved first to ${res.data.previousBackup}`, 'success');
      await loadBackups();
    })();
  };

  return (
    <>
      <Card>
        <CardHeader
          title="Backups"
          subtitle={
            live
              ? 'Verified snapshots of the local database, written next to it under %APPDATA%\\NexusAI\\backups'
              : 'Snapshots of the local database — the browser demo has no database to copy'
          }
          actions={
            <Button variant="primary" size="sm" loading={creating} onClick={createBackup}>
              {live ? 'Create backup' : 'Create backup (needs desktop build)'}
            </Button>
          }
        />
        <CardBody className="pt-1">
          {loading && <LoadingState label="Reading the backup folder…" className="py-4" />}
          {!loading && backups.length === 0 && (
            <p className="py-3 text-xs text-ink-muted">
              {live
                ? 'No backups yet. “Create backup” copies the database, keeps the copy beside the original, and verifies it before reporting success.'
                : 'No backups. The browser demo never writes files, so this list stays empty.'}
            </p>
          )}
          {backups.length > 0 && (
            <ul className="divide-y divide-surface-line">
              {backups.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-2.5">
                  <HardDrive size={14} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="mono-num block truncate text-xs text-ink-primary">{b.name}</span>
                    <span className="block truncate text-2xs text-ink-faint">
                      {new Date(b.createdAt).toLocaleString()} · schema v{b.schemaVersion}
                      {b.verified ? ' · verified' : ' · NOT verified'}
                    </span>
                  </span>
                  <span className="mono-num shrink-0 text-2xs text-ink-muted">{formatBytes(bytesToGB(b.sizeBytes))}</span>
                  <Button size="xs" variant="ghost" disabled={restoreBusy} onClick={() => setRestoring(b)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Where backups go" />
        <CardBody className="pt-2">
          <p className="text-xs leading-relaxed text-ink-muted">
            {live
              ? 'The core writes each backup beside the live database and records it in a table, so this list reflects files that exist. A custom archive folder is not implemented yet.'
              : 'The browser demo has no archive folder: nothing is written to disk.'}
          </p>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={restoring !== null}
        title={`Restore ${restoring?.name ?? ''}?`}
        message={
          <>
            Restoring <strong>replaces the current conversations, settings and memory rows</strong> with the
            snapshot. The core first copies the current database to a pre-restore file and verifies the snapshot
            before swapping.
          </>
        }
        confirmLabel="Restore"
        danger
        onCancel={() => setRestoring(null)}
        onConfirm={restore}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Portability                                                         */
/* ------------------------------------------------------------------ */

function PortabilitySection() {
  const { toast } = useToast();
  const planned = () => toast('Portable packaging is milestone M6 — not implemented in this build', 'info');

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Portable folder mode" />
          <CardBody className="pt-2">
            <p className="text-xs leading-relaxed text-ink-muted">
              A self-contained NEXUS folder you could copy to another Windows machine — database, settings and the
              local model directory travelling together. Packaging is milestone M6 in PHASE2_MILESTONES.md; this
              build installs nothing outside its own data folder and has no external dependency.
            </p>
            <Button variant="secondary" className="mt-3" onClick={planned}>
              Enable portable mode
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Import from another machine" />
          <CardBody className="pt-2">
            <p className="text-xs leading-relaxed text-ink-muted">
              Point NEXUS at a portable folder or a backup archive and it would reconcile memory, KB index and agent
              config — with a preview of conflicts before anything is written. Backup files created by this build
              already restore through Backup → Restore; the import wizard itself is not implemented.
            </p>
            <Button variant="secondary" className="mt-3" onClick={planned}>
              Import wizard
            </Button>
          </CardBody>
        </Card>
      </div>
      <p className="text-2xs text-ink-faint">
        Both flows are honest placeholders — clicking them names the milestone instead of faking progress.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

function AboutSection() {
  const { toast } = useToast();
  const { live } = useLive();
  const [checking, setChecking] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const check = () => {
    if (checking) return;
    setChecking(true);
    window.setTimeout(() => {
      setChecking(false);
      toast("You're up to date (simulated check — no network request made)", 'success');
    }, 1200);
  };

  return (
    <>
      <Card>
        <CardHeader
          title="NEXUS AI"
          subtitle={live ? 'Local AI Agent Platform — Phase 2 desktop build' : 'Local AI Agent Platform — UI prototype'}
        />
        <CardBody className="pt-2">
          <div className="flex items-center gap-4">
            <Logo size={48} />
            <div>
              <p className="text-lg font-bold tracking-tight text-ink-primary">NEXUS AI</p>
              <p className="text-xs text-ink-muted">
                {live
                  ? 'Offline-first. Local by design. A real engine and a local database behind this screen.'
                  : 'Offline-first. Local by design. Honest about what is simulated.'}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-0.5">
            <KeyValue k="Version" v={live ? '0.1.0 — Phase 2 (M2)' : '0.1.0 — Phase 1'} mono />
            <KeyValue k="Build channel" v={live ? 'tauri-desktop' : 'ui-prototype'} mono />
            <KeyValue k="Engine" v={live ? 'llama-server sidecar — state on Dashboard' : 'None — frontend only'} />
            <KeyValue
              k="Persistence"
              v={live ? 'SQLite database under %APPDATA%\\NexusAI' : 'React state + localStorage flags'}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setLicenseOpen(true)}>
              License
            </Button>
            <Button variant="secondary" onClick={() => setNotesOpen(true)}>
              Release notes
            </Button>
            <Button variant="secondary" loading={checking} onClick={check}>
              Check for updates
            </Button>
          </div>
          {checking && <LoadingState label="Simulating update check — no request is sent" className="py-4" />}
        </CardBody>
      </Card>

      <Modal
        open={licenseOpen}
        onClose={() => setLicenseOpen(false)}
        title="License"
        subtitle={live ? 'Pre-1.0 development build' : 'Prototype content terms'}
        size="md"
      >
        <div className="space-y-3 text-xs leading-relaxed text-ink-secondary">
          <p>
            NEXUS AI is a pre-1.0 development build. The interface may be evaluated internally; it is not a licensed
            product and confers no rights to any backend, model weights, or trademark.
          </p>
          <p>
            {live
              ? 'Conversations, messages, settings, activity and memory rows shown in this build come from the local database. Catalogs and screens without a core command behind them stay labelled as simulated.'
              : 'All displayed data — conversations, agents, models, telemetry, activity events — is mock content authored for demonstration. No third-party model output is included.'}
          </p>
          <p>
            The final application will ship under the commercial license announced at general availability. Until
            then, treat this build as a development artifact, not a release.
          </p>
        </div>
      </Modal>

      <Modal
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title={live ? 'Release notes — 0.1.0 (Phase 2, M3)' : 'Release notes — 0.1.0 (Phase 1)'}
        subtitle={live ? 'What this build actually does' : 'Scope of the UI prototype'}
        size="md"
      >
        {live ? (
          <ul className="space-y-2 text-xs leading-relaxed text-ink-secondary">
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Real local inference through the pinned llama-server sidecar; answers stream from this machine.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Conversations, messages, settings, activity and memory rows stored in SQLite under %APPDATA%\NexusAI.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Verified database backup, guarded restore, JSON export of owner data and a short-term-memory purge.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Watched folders are parsed locally (md, txt, csv, pdf, docx, xlsx) into a searchable index; chat answers cite what retrieval actually returned.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> An explicit "remember that …" request proposes a memory that stays invisible to retrieval until you approve it here.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-warn" /> Still simulated in this build: agent execution, tools, internet policy, learning lab, model downloads.</li>
          </ul>
        ) : (
          <ul className="space-y-2 text-xs leading-relaxed text-ink-secondary">
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Eleven screens: Dashboard, Chat, Agents, Models, Knowledge, Memory, Tools, Learning Lab, Internet, Activity, Settings.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Offline-first shell with mode chip, dark/light theme and density direction.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Simulated chat loop with canned replies, attachments as UI-only chips, per-conversation model/agent choice.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Internet policy, trusted sources and approval prompts — stated honestly as prototype state.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-ok" /> Activity timeline with filter/search and pending-approval decisions.</li>
            <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-state-warn" /> Not in this build: real inference, downloads, network calls, persistence, multi-user.</li>
          </ul>
        )}
      </Modal>
    </>
  );
}
