// Drives the real NEXUS AI Tauri window over the WebView2 DevTools Protocol.
//
// This is not a mock. It attaches to the running app, types through the real composer,
// clicks the real buttons, kills the real engine process, and records what the real
// renderer painted after talking to the real local model.
//
// Usage (from the repo root, in a second terminal while `npm run tauri dev` is running):
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
//   npm run tauri dev
//   node tools/ui-gate.mjs
//
// Env:
//   NEXUS_CDP_PORT   DevTools port (default 9333; 9222 is often taken by a normal Chrome)
//   NEXUS_SHOT       screenshot path (default <repo>/screenshots/m1-live-ui-gate.png)
//   NEXUS_GATE_OUT   evidence JSON path (default <repo>/.ui-gate.json)
//
// Exit code 0 means every step completed. The evidence file is written in both cases.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.NEXUS_CDP_PORT || 9333);
const OUT = process.env.NEXUS_SHOT || join(ROOT, 'screenshots', 'm1-live-ui-gate.png');
const EVIDENCE_PATH = process.env.NEXUS_GATE_OUT || join(ROOT, '.ui-gate.json');
const DEV_URL = /^https?:\/\/(localhost|127\.0\.0\.1):5173/;
const log = (...a) => console.log(...a);

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`targets HTTP ${res.status}`);
  return res.json();
}

async function findTarget(deadlineMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const targets = await listTargets();
      const page = targets.find((t) => t.type === 'page' && DEV_URL.test(t.url));
      if (page) return page;
    } catch {
      /* devtools endpoint not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no Tauri page on the devtools endpoint');
}

class CDP {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }
  async open(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolveOpen, reject) => {
      this.ws.addEventListener('open', resolveOpen, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, reject) => {
      this.pending.set(id, { resolve: res, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(script) {
    const res = await this.send('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`page threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    }
    return res.result.value;
  }
  async waitFor(label, script, timeoutMs, everyMs = 400) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
      last = await this.eval(script);
      if (last) return { ok: true, ms: Date.now() - start, value: last };
      await new Promise((r) => setTimeout(r, everyMs));
    }
    throw new Error(`timeout waiting for ${label} (last=${JSON.stringify(last)})`);
  }
}

// Page-side helpers injected once.
const HELPERS = `
window.__nexusGate = {
  textOf(el) { return (el && el.textContent || '').replace(/\\s+/g, ' ').trim(); },
  buttons() { return [...document.querySelectorAll('button')]; },
  byText(t) { return this.buttons().find(b => this.textOf(b) === t); },
  composer() { return document.querySelector('textarea[aria-label="Message input"]'); },
  type(text) {
    const ta = this.composer();
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  assistantText() {
    return [...document.querySelectorAll('div.group')]
      .filter(d => this.textOf(d).startsWith('NEXUS'))
      .map(d => this.textOf(d.querySelector('div.rounded-card') || d));
  },
  newestAssistant() { const a = this.assistantText(); return a[a.length - 1] || ''; },
  hasRealText() {
    const t = this.newestAssistant();
    return t.length >= 5 && !/^Waiting for the engine/.test(t);
  },
  engineLine() {
    const p = [...document.querySelectorAll('p')].find(x => /Local engine|No installed model/.test(this.textOf(x)));
    return p ? this.textOf(p) : null;
  },
  contextRail() {
    const el = [...document.querySelectorAll('aside span')].find(s => /^\\d[\\d,]*$/.test(this.textOf(s)));
    return el ? this.textOf(el) : null;
  },
  errorBanner() {
    const el = [...document.querySelectorAll('div')].find(d => /^[a-z][a-z0-9]*(\\.[a-z0-9]+)*: .+/.test(this.textOf(d)) && this.textOf(d).length < 400);
    return el ? this.textOf(el) : null;
  },
  streaming() { return !!this.byText('Stop') || !!this.byText('Stopping…') || !!this.byText('Loading…'); },
  stopButton() { return this.byText('Stop'); },
  sendButton() { return this.byText('Send'); },
  stoppedNote() { return this.textOf(document.querySelector('p.text-state-warn')); }
}; true;
`;

const evidence = { steps: [], consoleErrors: [], startedAt: new Date().toISOString() };
const step = (name, data) => {
  evidence.steps.push({ name, at: new Date().toISOString(), ...data });
  log(`[${name}]`, JSON.stringify(data));
};

try {
  const target = await findTarget();
  log('attached target:', target.url);

  const cdp = new CDP();
  await cdp.open(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Console.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  const host = await cdp.waitFor(
    'Tauri host',
    `Boolean(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)`,
    20000,
  );
  step('host-detected', { isTauri: true, waitedMs: host.ms });

  const status = await cdp.eval(`window.__TAURI__.core.invoke('ipc', { command: 'engine.status', args: {} })`);
  const listed = await cdp.eval(`window.__TAURI__.core.invoke('ipc', { command: 'model.list', args: { installedOnly: true, limit: 100 } })`);
  step('ipc-direct', {
    engineStatus: status,
    models: (listed?.items ?? []).map((m) => ({ id: m.id, name: m.name, ctx: m.contextWindow })),
  });

  await cdp.eval(HELPERS);

  // The app boots on the dashboard; open Chat through the real router.
  await cdp.eval(`location.hash = '#/chat'; true`);
  await cdp.waitFor('composer', `Boolean(window.__nexusGate.composer())`, 30000);
  const engine = await cdp.waitFor('engine footer', `window.__nexusGate.engineLine()`, 30000);
  step('chat-ready', { engineLine: engine.value, url: await cdp.eval('location.pathname') });

  // 1) A real answer, typed through the composer and sent with the real Send button.
  const prompt = 'Reply with exactly: NEXUS OK';
  const t0 = Date.now();
  await cdp.eval(`window.__nexusGate.type(${JSON.stringify(prompt)})`);
  await cdp.waitFor('Send enabled', `(() => { const b = window.__nexusGate.sendButton(); return b && !b.disabled; })()`, 15000);
  await cdp.eval(`window.__nexusGate.sendButton().click(); true`);

  const started = await cdp.waitFor('generation started', `window.__nexusGate.streaming()`, 20000);
  step('stream-started', {
    afterClickMs: started.ms,
    stopLabel: await cdp.eval(`window.__nexusGate.textOf(window.__nexusGate.byText('Loading…') || window.__nexusGate.byText('Stop'))`),
  });

  const firstText = await cdp.waitFor('first assistant characters', `window.__nexusGate.hasRealText()`, 180000, 250);
  step('first-characters', {
    msSinceSend: Date.now() - t0,
    waitedMs: firstText.ms,
    text: await cdp.eval('window.__nexusGate.newestAssistant().slice(0, 80)'),
  });

  const done = await cdp.waitFor(
    'answer finished',
    `(() => { const n = window.__nexusGate.newestAssistant(); return !window.__nexusGate.streaming() && window.__nexusGate.hasRealText() ? n : null; })()`,
    180000,
    300,
  );
  void done;
  const answer = await cdp.eval(`
    (() => ({
      text: window.__nexusGate.newestAssistant(),
      context: window.__nexusGate.contextRail(),
      error: window.__nexusGate.errorBanner(),
      engineLine: window.__nexusGate.engineLine(),
      sendEnabled: !window.__nexusGate.sendButton()?.disabled
    }))()
  `);
  step('answer-complete', { totalMs: Date.now() - t0, ...answer });

  mkdirSync(dirname(OUT), { recursive: true });
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    writeFileSync(OUT, Buffer.from(r.data, 'base64'));
    step('screenshot', { path: OUT });
  });

  // 2) Stop must interrupt a real generation, not just flip a label.
  const t1 = Date.now();
  await cdp.eval(`window.__nexusGate.type(${JSON.stringify('Count slowly from 1 to 200, one number per line.')})`);
  await cdp.waitFor('Send enabled again', `(() => { const b = window.__nexusGate.sendButton(); return b && !b.disabled; })()`, 15000);
  await cdp.eval(`window.__nexusGate.sendButton().click(); true`);
  await cdp.waitFor('stop visible', `Boolean(window.__nexusGate.stopButton())`, 60000);
  const beforeStop = await cdp.eval('window.__nexusGate.newestAssistant()');
  await cdp.eval(`window.__nexusGate.stopButton().click(); true`);
  const stopSettled = await cdp.waitFor(
    'stream halted',
    `(() => { const note = window.__nexusGate.stoppedNote(); return !window.__nexusGate.streaming() && note ? { note } : null; })()`,
    45000,
    250,
  );
  const stopped = await cdp.eval(`
    (() => ({
      note: window.__nexusGate.stoppedNote(),
      streaming: window.__nexusGate.streaming(),
      textLengthAtStop: window.__nexusGate.newestAssistant().length,
      sendBack: Boolean(window.__nexusGate.sendButton())
    }))()
  `);
  await new Promise((r) => setTimeout(r, 2500));
  const grewAfterStop = await cdp.eval('window.__nexusGate.newestAssistant().length');
  step('stop', {
    msToStopClick: Date.now() - t1,
    charsBeforeStop: beforeStop.length,
    note: stopped.note,
    streamingAfter: stopped.streaming,
    charsAfterSettle: grewAfterStop,
    sendBack: stopped.sendBack,
    settled: stopSettled.value,
  });

  // 3) Reload-shaped facts the user sees.
  const rail = await cdp.eval(`
    (() => {
      const cards = [...document.querySelectorAll('aside')].map(a => window.__nexusGate.textOf(a));
      return { rail: cards.join(' | ').slice(0, 400), messages: document.querySelectorAll('div.group').length };
    })()
  `);
  step('rail', rail);

  // 4) Engine death mid-generation: the app must survive, say so, and recover on retry.
  await cdp.eval(`window.__nexusGate.type(${JSON.stringify('Write a long paragraph about the sea.')})`);
  await cdp.waitFor('Send enabled for crash test', `(() => { const b = window.__nexusGate.sendButton(); return b && !b.disabled; })()`, 15000);
  await cdp.eval(`window.__nexusGate.sendButton().click(); true`);
  await cdp.waitFor('crash-test streaming', `Boolean(window.__nexusGate.stopButton())`, 60000);
  const beforeCrash = await cdp.eval('window.__nexusGate.newestAssistant().length');
  let killOutput = '';
  try {
    killOutput = execSync('taskkill /IM llama-server.exe /F', { encoding: 'utf8' }).trim();
  } catch (e) {
    killOutput = `taskkill failed: ${e.status}: ${(e.stdout || e.stderr || '').trim()}`;
  }
  const crashed = await cdp.waitFor(
    'error surfaced',
    `(() => { const e = window.__nexusGate.errorBanner(); return e || null; })()`,
    60000,
    400,
  );
  const afterCrash = await cdp.eval(`
    (() => ({
      banner: window.__nexusGate.errorBanner(),
      thinking: window.__nexusGate.streaming(),
      messages: document.querySelectorAll('div.group').length,
      failedNote: [...document.querySelectorAll('p')].some(p => /Generation failed/.test(window.__nexusGate.textOf(p)) || /incomplete/.test(window.__nexusGate.textOf(p)))
    }))()
  `);
  step('engine-killed', { killOutput, charsBefore: beforeCrash, ...afterCrash, waitedMs: crashed.ms });

  // Recovery: the next send must restart the engine and answer again.
  const t3 = Date.now();
  await cdp.eval(`window.__nexusGate.type(${JSON.stringify('Reply with exactly: RECOVERED')})`);
  await cdp.waitFor('Send enabled after crash', `(() => { const b = window.__nexusGate.sendButton(); return b && !b.disabled; })()`, 30000);
  await cdp.eval(`window.__nexusGate.sendButton().click(); true`);
  const recovered = await cdp.waitFor(
    'recovered answer',
    `(() => { const n = window.__nexusGate.newestAssistant(); return !window.__nexusGate.streaming() && /RECOVERED/i.test(n) ? n : null; })()`,
    240000,
    400,
  );
  step('recovered', {
    ms: Date.now() - t3,
    text: recovered.value,
    engineLine: await cdp.eval('window.__nexusGate.engineLine()'),
  });

  const external = cdp.events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params.request.url)
    .filter((u) => !/^(http:\/\/(127\.0\.0\.1|localhost)(:\d+)?|tauri:\/\/|data:|blob:|about:)/.test(u) && !u.startsWith('http://ipc.localhost'));
  step('network', { externalRequestCount: external.length, external: [...new Set(external)].slice(0, 20) });

  evidence.consoleErrors = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
    .map((e) => JSON.stringify(e.params).slice(0, 400));
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  log('EVIDENCE', JSON.stringify(evidence, null, 2));
  process.exit(0);
} catch (err) {
  evidence.error = String((err && err.stack) || err);
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  log('GATE FAILED:', evidence.error);
  process.exit(1);
}
