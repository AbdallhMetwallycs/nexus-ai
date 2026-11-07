/**
 * NEXUS AI — Phase 2 IPC client (transport layer)
 *
 * The typed counterpart of PHASE2_IPC_CONTRACT.md §1–§2. It declares how a command
 * travels, not what it does. Three rules shape this file:
 *
 *  1. No new dependency. The host bridge is detected structurally on `globalThis`
 *     (a Tauri-style `window.__TAURI__`), so the contract stays usable from a plain
 *     browser build and from the future Tauri shell without either importing a package.
 *  2. No fake success. When no core is attached — which is every build up to M1 —
 *     `resolveTransport()` returns a transport whose every command rejects to
 *     `not_implemented` and whose subscriptions never fire. Screens must therefore
 *     keep their Phase 1 mock path until a command actually returns data.
 *  3. Nothing imports this file yet. It is the seam, wired at M1/M2 per
 *     PHASE2_MILESTONES.md; a screen importing it before the core exists would only
 *     be able to render errors.
 */

import type {
  ArgsTuple,
  CommandName,
  EventHandler,
  EventName,
  NexusError,
  PayloadOf,
  ResOf,
  Result,
  Unsubscribe,
} from './ipc';

export type { ArgsTuple, CommandName, EventHandler, EventName, NexusError, PayloadOf, ResOf, Result, Unsubscribe };

/* ------------------------------------------------------------------ */
/* Transport interface                                                 */
/* ------------------------------------------------------------------ */

/**
 * `tauri` — a real core answered the handshake.
 * `not_implemented` — no core in this build; every call is an honest refusal.
 */
export type TransportKind = 'tauri' | 'not_implemented';

export interface NexusTransport {
  readonly kind: TransportKind;

  /**
   * Commands with no arguments take no parameter at all (`ArgsTuple` collapses to
   * `[]`), so a caller can never pass `{}` where nothing is expected.
   */
  call<C extends CommandName>(command: C, ...args: ArgsTuple<C>): Promise<Result<ResOf<C>>>;

  /**
   * Subscribe to a push channel from the core. Returns an idempotent unsubscriber.
   * The UI renders what it is told; it never infers live state from timing.
   */
  subscribe<E extends EventName>(event: E, handler: EventHandler<E>): Unsubscribe;
}

/* ------------------------------------------------------------------ */
/* The honest default                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one place the phrase "not wired yet" is written, so no screen invents its own
 * wording and none of them invents a success.
 */
export function notImplementedError(command: CommandName): NexusError {
  return {
    code: 'not_implemented',
    message: `“${command}” is not implemented in this build.`,
    detail:
      'This screen is still running on its Phase 1 mock dataset. The command exists in ' +
      'src/contract/ipc.ts and PHASE2_IPC_CONTRACT.md; it becomes real per PHASE2_MILESTONES.md ' +
      '(M1 engine, M2 storage, M3 knowledge, M4 agents, M5 learning, M6 packaging).',
    retryable: false,
  };
}

export function notImplementedResult<T>(command: CommandName): Result<T> {
  return { ok: false, error: notImplementedError(command) };
}

/**
 * What every build before M1 resolves to. Subscriptions return a real unsubscriber
 * but never deliver a payload — there is no core to push.
 */
export const notImplementedTransport: NexusTransport = {
  kind: 'not_implemented',
  call: <C extends CommandName>(command: C, ..._args: ArgsTuple<C>): Promise<Result<ResOf<C>>> =>
    Promise.resolve(notImplementedResult<ResOf<C>>(command)),
  subscribe: <E extends EventName>(_event: E, _handler: EventHandler<E>): Unsubscribe => () => undefined,
};

/* ------------------------------------------------------------------ */
/* Host bridge detection (dependency-free)                             */
/* ------------------------------------------------------------------ */

type InvokeFn = (command: string, payload?: unknown) => Promise<unknown>;
type ListenFn = (event: string, handler: (envelope: TauriEnvelope) => unknown) => Promise<TauriUnlisten>;

/** Tauri hands the handler an envelope; the contract payload lives under `.payload`. */
interface TauriEnvelope {
  payload?: unknown;
}
type TauriUnlisten = () => void;

/** Shape we probe for, loosely on purpose: versions differ, so only the call site must match. */
interface TauriBridgeHost {
  core?: { invoke?: InvokeFn };
  event?: { listen?: ListenFn };
  invoke?: InvokeFn;
  listen?: ListenFn;
}

interface ResolvedBridge {
  invoke: InvokeFn;
  listen: ListenFn;
}

/**
 * Structural detection only. A window without both a callable invoke and a callable
 * listen is treated as "no core", which routes the app to the honest transport
 * instead of half-working against a mismatched host.
 */
export function detectHostBridge(): ResolvedBridge | null {
  const host = globalThis as { window?: { __TAURI__?: TauriBridgeHost } };
  const bridge = host.window?.__TAURI__;
  if (!bridge) return null;

  const invoke = bridge.core?.invoke ?? bridge.invoke;
  const listen = bridge.event?.listen ?? bridge.listen;
  if (typeof invoke !== 'function' || typeof listen !== 'function') return null;

  return { invoke, listen };
}

/** A core error that arrives as something else must not become a silent success. */
function normalizeRejection(command: CommandName, thrown: unknown): NexusError {
  if (isNexusError(thrown)) return thrown;

  const text =
    thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : `${command} failed`;
  return {
    code: 'internal',
    message: `The core rejected “${command}” without a contract error.`,
    detail: text,
    retryable: false,
  };
}

/** Runtime guard, not a type trick: data crossing the IPC boundary is untrusted. */
export function isNexusError(value: unknown): value is NexusError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    (candidate.detail === undefined || typeof candidate.detail === 'string') &&
    typeof candidate.retryable === 'boolean'
  );
}

/**
 * Transport for a build that actually runs inside the Tauri shell. Created only from
 * `resolveTransport()` when a bridge is present; M1 is where it first gets used.
 */
export function createTauriTransport(bridge: ResolvedBridge): NexusTransport {
  return {
    kind: 'tauri',
    async call<C extends CommandName>(command: C, ...args: ArgsTuple<C>): Promise<Result<ResOf<C>>> {
      try {
        const data = (await bridge.invoke(command, args[0])) as ResOf<C>;
        return { ok: true, data };
      } catch (thrown) {
        return { ok: false, error: normalizeRejection(command, thrown) };
      }
    },
    subscribe<E extends EventName>(event: E, handler: EventHandler<E>): Unsubscribe {
      let unlisten: TauriUnlisten | null = null;
      let cancelled = false;

      void bridge
        .listen(event, (envelope) => {
          handler((envelope?.payload ?? envelope) as PayloadOf<E>);
        })
        .then((dispose) => {
          unlisten = dispose;
          if (cancelled && typeof dispose === 'function') dispose();
        })
        .catch(() => {
          // A channel that cannot be opened must not look like a live one. The UI
          // keeps showing the last value it received, which here is none.
        });

      return () => {
        cancelled = true;
        if (typeof unlisten === 'function') unlisten();
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

let cached: NexusTransport | null = null;

/**
 * The transport screens will ask for once Phase 2 wiring begins. Cached because the
 * host does not appear mid-session: either the shell injected `__TAURI__` before the
 * bundle ran, or it did not.
 */
export function resolveTransport(): NexusTransport {
  if (cached) return cached;
  const bridge = detectHostBridge();
  cached = bridge ? createTauriTransport(bridge) : notImplementedTransport;
  return cached;
}
