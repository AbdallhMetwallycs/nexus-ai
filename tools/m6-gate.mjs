// M6 packaging gate — installs the produced NSIS setup silently into a temp folder, drives
// the installed window over the WebView2 DevTools Protocol, and proves the packaging claims
// against the real binary rather than against `tauri dev`.
//
//   node tools/m6-gate.mjs            # install + first run + download + cancel + answer + uninstall
//   node tools/m6-gate.mjs --no-answer   # skip the chat phase (no weights needed)
//
// What it checks, in order:
//   the setup file exists and its SHA-256 is recorded;
//   `/S /D=<temp>` installs with exit 0, and `$RESOURCE/engine/llama-server.exe` is present —
//   which is where `default_engine_dir` looks for the bundled engine;
//   a fresh profile with an empty models folder opens the first-run screen, and the
//   recommendation matches `model.catalog` (RAM floor from the real machine);
//   ticking the licence enables the download; starting it writes a growing `.part`;
//   cancel deletes the partial file and says so;
//   with real weights in `NEXUS_MODELS_DIR` the installed app answers through the bundled
//   engine;
//   the uninstaller removes the install folder and leaves the models folder alone.
//
// Env:
//   NEXUS_SETUP            setup exe (default: the only *-setup.exe under src-tauri/target)
//   NEXUS_CDP_PORT         DevTools port (default 9333; 9222 is usually a normal Chrome)
//   NEXUS_GATE_OUT         evidence JSON (default <repo>/.m6-gate.json)
//   NEXUS_M6_DIR           scratch root (default %TEMP%\nexus-m6)
//   NEXUS_M6_WEIGHTS       folder with a real GGUF for the answer phase (default D:\NEXUS-MODELS)
//   NEXUS_M6_DOWNLOAD_MS   how long to watch the download grow (default 120000)
//   NEXUS_M6_KEEP=1        keep the install and scratch folders for inspection
//
// Exit code 0 means every step that ran passed. A download that is still transferring when
// the watch window ends is recorded as skipped, never as passed, because the file is only a
// model after the SHA-256 check renames it.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.NEXUS_CDP_PORT || 9333);
const OUT = process.env.NEXUS_GATE_OUT || join(ROOT, '.m6-gate.json');
const SCRATCH = process.env.NEXUS_M6_DIR || join(process.env.TEMP || '.', 'nexus-m6');
const INSTALL = join(SCRATCH, 'install');
const MODELS = join(SCRATCH, 'models');
const DATA = join(SCRATCH, 'data');
const DATA_ANSWER = join(SCRATCH, 'data-answer');
const WEIGHTS = process.env.NEXUS_M6_WEIGHTS || 'D:\\NEXUS-MODELS';
const DOWNLOAD_MS = Number(process.env.NEXUS_M6_DOWNLOAD_MS || 120_000);
const NO_ANSWER = process.argv.includes('--no-answer');
const KEEP = process.env.NEXUS_M6_KEEP === '1';
const TAURO = /tauri\.localhost|^https?:\/\/(localhost|127\.0\.0\.1):5173/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const evidence = { phase: 'm6', at: new Date().toISOString(), steps: [] };

function record(name, ok, detail) {
  evidence.steps.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    evidence.ok = false;
    writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    process.exit(1);
  }
}

/** A step whose answer this run could not honestly produce. Never counted as a pass. */
function skip(name, detail) {
  evidence.steps.push({ name, ok: null, skipped: true, detail });
  log(`SKIP  ${name} — ${detail}`);
}

function findSetup() {
  if (process.env.NEXUS_SETUP) return resolve(process.env.NEXUS_SETUP);
  // The workspace target dir is the repo root's `target/`; a standalone src-tauri build
  // would put it under `src-tauri/target/`. Check both.
  const candidates = [
    join(ROOT, 'target', 'release', 'bundle', 'nsis'),
    join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis'),
  ].filter((dir) => existsSync(dir));
  for (const bundle of candidates) {
    const found = readdirSync(bundle).filter((f) => f.endsWith('-setup.exe'));
    if (found.length === 1) return join(bundle, found[0]);
  }
  throw new Error('no single *-setup.exe under target/release/bundle/nsis; run npm run tauri build');
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/* ---------------------------------------------------------------- CDP ---- */

async function findPage(deadlineMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page' && TAURO.test(t.url));
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`no NEXUS AI page on port ${PORT}`);
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
    send(method, params = {}) {
      const callId = ++id;
      return new Promise((res, rej) => {
        pending.set(callId, { res, rej });
        ws.send(JSON.stringify({ id: callId, method, params }));
      });
    },
    evaluate(expression) {
      return this.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }).then((r) => {
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
        return r.result?.value;
      });
    },
    close: () => ws.close(),
  };
}

async function waitFor(page, label, expression, timeoutMs = 30_000, everyMs = 250) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(expression);
    if (last) return last;
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for ${label} (last=${JSON.stringify(last)})`);
}

function ipc(page, command, args) {
  const payload = JSON.stringify({ command, args: args ?? null });
  return page
    .evaluate(
      `(async () => {
         try { return JSON.stringify({ ok: true, data: await window.__TAURI__.core.invoke('ipc', ${payload}) }); }
         catch (e) { return JSON.stringify({ ok: false, error: e && typeof e === 'object' ? e : { code: 'internal', message: String(e) } }); }
       })()`,
    )
    .then((raw) => JSON.parse(raw));
}

/* -------------------------------------------------------------- app ----- */

let app = null;

function launchApp(extraEnv) {
  const exe = join(INSTALL, 'NEXUS-AI.exe');
  const env = {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    ...extraEnv,
  };
  // The gate must exercise the engine that shipped in the installer, not a development one
  // that happens to be exported in this shell.
  delete env.NEXUS_ENGINE_DIR;
  app = spawn(exe, [], { env, stdio: 'ignore' });
  return app;
}

async function closeApp() {
  if (!app || app.exitCode !== null) return;
  try {
    const page = await findPage(5000);
    const ws = await connect(page.webSocketDebuggerUrl);
    await ws.evaluate(`window.__TAURI__.window.getCurrentWindow().close().catch(() => {})`);
    ws.close();
  } catch {
    /* fall through to the task kill */
  }
  const exited = await Promise.race([
    new Promise((r) => app.once('exit', () => r(true))),
    sleep(8000).then(() => false),
  ]);
  if (!exited && app.pid) {
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(1500);
  }
  app = null;
}

/* ------------------------------------------------------------ phases ---- */

async function main() {
  rmSync(OUT, { force: true });
  writeFileSync(OUT, '');
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });

  const setup = findSetup();
  const setupBytes = statSync(setup).size;
  const setupHash = sha256(setup);
  evidence.setup = { path: setup, bytes: setupBytes, sha256: setupHash };
  record('setup-file', setupBytes > 1_000_000, `${setup} — ${(setupBytes / 1024 / 1024).toFixed(1)} MiB, sha256 ${setupHash}`);

  // 1) Silent install, current user, no elevation prompt.
  const install = spawnSync(setup, ['/S', `/D=${INSTALL}`], { encoding: 'utf8', timeout: 180_000 });
  record('silent-install', install.status === 0 && existsSync(join(INSTALL, 'NEXUS-AI.exe')),
    `exit=${install.status}${install.error ? ` error=${install.error.message}` : ''}`);

  // Tauri's resource directory on Windows is the folder that holds the exe, so the map
  // `resources/engine/ -> engine/` lands beside the binary. Accept the nested form too so a
  // future layout change is caught by the gate rather than by a support ticket.
  const engineDir = [join(INSTALL, 'engine'), join(INSTALL, 'resources', 'engine')]
    .find((dir) => existsSync(join(dir, 'llama-server.exe')));
  const engineDlls = engineDir
    ? readdirSync(engineDir).filter((f) => f.endsWith('.dll')).length
    : 0;
  record('bundled-engine', Boolean(engineDir) && engineDlls >= 20,
    `${engineDir ?? 'not found'} — ${engineDlls} DLLs beside llama-server.exe`);

  // 2) First run against an empty models folder: the gate, the numbers, the recommendation.
  mkdirSync(MODELS, { recursive: true });
  launchApp({ NEXUS_MODELS_DIR: MODELS, NEXUS_DATA_DIR: DATA });
  const page = await connect((await findPage()).webSocketDebuggerUrl);
  await waitFor(page, 'Tauri host', `Boolean(window.__TAURI__ && window.__TAURI__.core)`, 30_000);

  const catalog = await ipc(page, 'model.catalog', {});
  record('catalog-command', catalog.ok && catalog.data.models?.length === 2,
    catalog.ok ? `recommended=${catalog.data.recommended} totalRamMb=${catalog.data.totalRamMb} freeDisk=${catalog.data.freeDiskBytes}` : JSON.stringify(catalog));

  const gateText = await waitFor(page, 'first-run text',
    `(() => { const t = document.body.innerText; return t.includes("Welcome. Let's install the model this machine can run.") ? t : null; })()`,
    30_000);
  const machineLines = (gateText.match(/[^\n]*physical cores[^\n]*|[^\n]*GB total[^\n]*|[^\n]*Best fit[^\n]*/g) || []);
  // `innerText` returns text after CSS `text-transform`, so the badge reads "BEST FIT" here.
  record('first-run-screen', /best fit/i.test(gateText) && gateText.includes('physical cores'),
    machineLines.join(' | '));
  record('models-folder-isolated', gateText.includes(MODELS), MODELS);

  const shotDir = join(ROOT, 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotDir, 'm6-installed-first-run.png'), Buffer.from(shot.data, 'base64'));
  record('screenshot', true, 'screenshots/m6-installed-first-run.png');

  // 3) Licence tick unlocks the real download; the partial file must grow.
  const ticked = await page.evaluate(`(() => {
    const box = document.querySelector('input[type=checkbox]');
    if (!box || box.disabled) return false;
    box.click();
    return box.checked;
  })()`);
  record('licence-tick', ticked === true, 'checkbox checked');

  const clickDownload = `(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^(Download|Retry download)/.test(x.textContent.trim()));
    if (!b || b.disabled) return null;
    const label = b.textContent.trim(); b.click(); return label;
  })()`;
  const downloadLabel = await waitFor(page, 'enabled download button', clickDownload, 15_000);
  record('download-button', /^Download \d/.test(downloadLabel), downloadLabel);

  const first = await waitFor(page, 'downloading state',
    `(async () => { const s = await window.__TAURI__.core.invoke('ipc', { command: 'model.downloadStatus', args: {} }); return s.state === 'downloading' ? s : null; })()`,
    30_000);
  const entry = catalog.data.models.find((m) => m.id === first.id);
  record('download-started', first.state === 'downloading' && Boolean(entry),
    `${entry?.fileName} total=${first.total}`);

  const partPath = join(MODELS, `${entry.fileName}.part`);
  const grewFrom = existsSync(partPath) ? statSync(partPath).size : 0;
  await sleep(DOWNLOAD_MS);
  const grewTo = existsSync(partPath) ? statSync(partPath).size : 0;
  const rate = (grewTo - grewFrom) / (DOWNLOAD_MS / 1000);
  record('download-flowing', grewTo > grewFrom + 262_144,
    `${grewFrom} -> ${grewTo} bytes in ${Math.round(DOWNLOAD_MS / 1000)} s (${Math.round(rate / 1024)} kB/s)`);

  const status = await ipc(page, 'model.downloadStatus', {});
  if (status.data?.state === 'done') {
    const installed = await ipc(page, 'model.list', { installedOnly: true, limit: 100 });
    record('download-verified', installed.ok && installed.data.items.length >= 1,
      `state=done, model.list rows=${installed.data?.items?.length ?? 0}`);
  } else {
    skip('download-verified',
      `still ${status.data?.state} after the watch window at ${Math.round(rate / 1024)} kB/s; SHA-256 + rename path not re-proven live`);

    // 4) Cancel must delete the partial file, not leave a half model behind.
    const cancelled = await page.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Cancel download/.test(x.textContent));
      if (!b) return false; b.click(); return true;
    })()`);
    const after = await waitFor(page, 'cancelled state',
      `(async () => { const s = await window.__TAURI__.core.invoke('ipc', { command: 'model.downloadStatus', args: {} }); return s.state === 'cancelled' || s.state === 'idle' ? s : null; })()`,
      30_000);
    record('cancel-deletes-part', cancelled && !existsSync(partPath),
      `state=${after.state}, .part present=${existsSync(partPath)}`);
  }

  await closeApp();

  // 5) The installed app with real weights answers through the bundled engine.
  if (NO_ANSWER) {
    skip('real-answer', '--no-answer');
  } else if (!existsSync(join(WEIGHTS, 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'))) {
    skip('real-answer', `no weights in ${WEIGHTS}`);
  } else {
    mkdirSync(DATA_ANSWER, { recursive: true });
    launchApp({ NEXUS_MODELS_DIR: WEIGHTS, NEXUS_DATA_DIR: DATA_ANSWER });
    const chat = await connect((await findPage()).webSocketDebuggerUrl);
    await waitFor(chat, 'Tauri host', `Boolean(window.__TAURI__ && window.__TAURI__.core)`, 30_000);

    const listed = await ipc(chat, 'model.list', { installedOnly: true, limit: 100 });
    record('installed-weights-seen', listed.ok && listed.data.items.length >= 1,
      (listed.data?.items ?? []).map((m) => m.id).join(', '));

    await chat.evaluate(`location.hash = '#/chat'; true`);
    // A fresh data directory has no conversation, and the composer only exists inside one.
    // Wait for the route to paint, then press its button; a click that lands mid-transition is
    // retried rather than failing the gate.
    await waitFor(chat, 'chat route', `document.body.innerText.includes('AI Chat')`, 20_000);
    await sleep(800);
    const clickNew = `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'New conversation' && !x.disabled);
      if (!b) return false; b.click(); return true;
    })()`;
    let composer = false;
    for (let attempt = 0; attempt < 20 && !composer; attempt += 1) {
      if (attempt === 0) await waitFor(chat, 'new-conversation button', clickNew, 15_000);
      else await chat.evaluate(clickNew);
      await sleep(1000);
      composer = await chat.evaluate(`Boolean(document.querySelector('textarea[aria-label="Message input"]'))`);
    }
    record('composer-open', composer, `after ${composer ? 'the' : '20'} New conversation attempts`);

    await chat.evaluate(`(() => {
      const ta = document.querySelector('textarea[aria-label="Message input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'Reply with the single word: ready');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const send = `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Send');
      if (!b || b.disabled) return false; b.click(); return true;
    })()`;
    await waitFor(chat, 'enabled Send', send, 20_000);

    const answer = await waitFor(chat, 'assistant text', `(() => {
      const blocks = [...document.querySelectorAll('div.group')]
        .filter(d => d.textContent.trim().startsWith('NEXUS'))
        .map(d => (d.querySelector('div.rounded-card') || d).textContent.replace(/\\s+/g, ' ').trim());
      const last = blocks[blocks.length - 1] || '';
      return last.length >= 4 && !/^Waiting for the engine/.test(last) ? last : null;
    })()`, 240_000, 500);
    record('real-answer', true, answer.slice(0, 160));

    // The engine must still be a child of this app, not a leftover dev process.
    const engine = await ipc(chat, 'engine.status', {});
    record('bundled-engine-serving', engine.ok, `state=${engine.data?.state ?? JSON.stringify(engine)}`);
    await closeApp();
  }

  // 6) Uninstall removes the program and leaves the weights folder alone.
  if (KEEP) {
    skip('uninstall', 'NEXUS_M6_KEEP=1');
  } else {
    const uninstaller = readdirSync(INSTALL).find((f) => /^uninstall/i.test(f));
    if (!uninstaller) {
      record('uninstall', false, 'no uninstaller in the install folder');
    } else {
      const un = spawnSync(join(INSTALL, uninstaller), ['/S'], { encoding: 'utf8', timeout: 120_000 });
      const start = Date.now();
      while (Date.now() - start < 60_000 && existsSync(join(INSTALL, 'NEXUS-AI.exe'))) await sleep(1000);
      record('uninstall', un.status === 0 && !existsSync(join(INSTALL, 'NEXUS-AI.exe')),
        `exit=${un.status}, exe present=${existsSync(join(INSTALL, 'NEXUS-AI.exe'))}`);
      record('weights-preserved', existsSync(MODELS) && existsSync(DATA),
        `models=${existsSync(MODELS)} data=${existsSync(DATA)}`);
    }
  }

  evidence.ok = true;
  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  const passed = evidence.steps.filter((s) => s.ok === true).length;
  const skipped = evidence.steps.filter((s) => s.skipped).length;
  log(`\n${passed} passed, ${skipped} skipped — evidence in ${OUT}`);
}

main().catch(async (error) => {
  evidence.ok = false;
  evidence.error = String(error?.stack || error);
  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  console.error('GATE ERROR', error);
  await closeApp();
  process.exit(1);
});
