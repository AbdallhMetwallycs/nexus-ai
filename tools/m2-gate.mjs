// M2 persistence gate — drives the running NEXUS AI window over the WebView2 DevTools
// Protocol and calls the same `ipc` command the UI calls.
//
// Two phases so the app can be restarted in between:
//
//   node tools/m2-gate.mjs seed     # create a conversation + settings in the real db
//   (quit the app, start it again)
//   node tools/m2-gate.mjs verify   # read them back, then backup → restore and re-read
//
// Env: NEXUS_CDP_PORT (default 9333), NEXUS_GATE_OUT (default .m2-gate.json)
//
// Exit code 0 means every step in that phase returned what it claims.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.NEXUS_CDP_PORT || 9333);
const OUT = process.env.NEXUS_GATE_OUT || join(ROOT, '.m2-gate.json');
const DEV_URL = /^https?:\/\/(localhost|127\.0\.0\.1):5173/;
const phase = process.argv[2] || 'verify';
const log = (...a) => console.log(...a);
const evidence = { phase, at: new Date().toISOString(), steps: [] };

function record(name, ok, detail) {
  evidence.steps.push({ name, ok, detail });
  appendFileSync(OUT, `${JSON.stringify({ name, ok, detail })}\n`);
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    evidence.ok = false;
    writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    process.exit(1);
  }
}

async function findPage(deadlineMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && DEV_URL.test(t.url));
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no Tauri page on port ${PORT}`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('devtools socket failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  });
  return {
    evaluate(expression) {
      const callId = ++id;
      return new Promise((res, rej) => {
        pending.set(callId, { res, rej });
        ws.send(
          JSON.stringify({
            id: callId,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      }).then((r) => {
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
        return r.result?.value;
      });
    },
    close: () => ws.close(),
  };
}

/** Call the real `ipc` command from inside the page and return the envelope. */
function ipc(page, command, args) {
  const payload = JSON.stringify({ command, args: args ?? null });
  // The Tauri command resolves with the data value and rejects with the contract error;
  // the UI's transport builds the envelope. Wrap it the same way here.
  return page
    .evaluate(
      `(async () => {
         try { return JSON.stringify({ ok: true, data: await window.__TAURI__.core.invoke('ipc', ${payload}) }); }
         catch (e) { return JSON.stringify({ ok: false, error: e && typeof e === 'object' ? e : { code: 'internal', message: String(e) } }); }
       })()`,
    )
    .then((raw) => JSON.parse(raw));
}

const marker = 'M2 gate conversation';

const run = async () => {
  writeFileSync(OUT, '');
  const page = await connect((await findPage()).webSocketDebuggerUrl);
  try {
    const handshake = await ipc(page, 'engine.status');
    record('the page reaches the real core', handshake.ok, handshake.ok ? 'engine.status answered' : handshake.error?.code);

    if (phase === 'seed') {
      const created = await ipc(page, 'chat.create', {
        title: marker,
        agentId: 'universal',
        modelId: 'm-none',
      });
      record('chat.create wrote a conversation', created.ok, created.ok ? created.data.id : created.error?.code);

      const theme = await ipc(page, 'settings.patch', { section: 'appearance', values: { theme: 'light' } });
      record('appearance.theme was saved', theme.ok && theme.data.sections.appearance.theme === 'light', 'light');

      const active = await ipc(page, 'settings.patch', { section: 'models', values: { active: 'm2-gate-model' } });
      record('models.active was saved', active.ok && active.data.sections.models.active === 'm2-gate-model', 'm2-gate-model');

      const listed = await ipc(page, 'chat.list', { limit: 100 });
      record('chat.list reads it back in this run', listed.ok && listed.data.items.some((c) => c.title === marker), `total ${listed.ok ? listed.data.total : '?'}`);
    } else {
      const listed = await ipc(page, 'chat.list', { limit: 100 });
      record(
        'the conversation survived the restart',
        listed.ok && listed.data.items.some((c) => c.title === marker),
        listed.ok ? `total ${listed.data.total}` : listed.error?.code,
      );
      const settings = await ipc(page, 'settings.get');
      record('settings survived the restart', settings.ok && settings.data.sections.appearance.theme === 'light', settings.ok ? settings.data.sections.appearance.theme : settings.error?.code);
      record('the active model survived the restart', settings.ok && settings.data.sections.models.active === 'm2-gate-model', settings.ok ? settings.data.sections.models.active : settings.error?.code);
      const painted = await page.evaluate(
        `JSON.stringify({ light: document.documentElement.classList.contains('light') })`,
      );
      record('the UI painted the saved theme', JSON.parse(painted).light, 'html.light');

      const before = await ipc(page, 'chat.list', { limit: 500 });
      const backup = await ipc(page, 'store.backup');
      record('store.backup wrote and verified a file', backup.ok && backup.data.verified === true, backup.ok ? backup.data.path : backup.error?.code);

      const restored = await ipc(page, 'store.restore', { path: backup.ok ? backup.data.path : '' });
      record('store.restore replaced the database', restored.ok, restored.ok ? `pre-restore ${restored.data.previousBackup}` : restored.error?.code);

      const after = await ipc(page, 'chat.list', { limit: 500 });
      record(
        'row counts are identical after restore',
        before.ok && after.ok && before.data.total === after.data.total,
        `${before.ok ? before.data.total : '?'} → ${after.ok ? after.data.total : '?'}`,
      );
    }
  } finally {
    page.close();
    evidence.ok = evidence.steps.every((s) => s.ok);
    writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  }
};

run().catch((err) => {
  log(`FAIL  ${err.message}`);
  writeFileSync(OUT, JSON.stringify({ phase, error: err.message }, null, 2));
  process.exit(1);
});
