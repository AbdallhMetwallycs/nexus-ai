// M3 knowledge-and-memory gate — drives the running NEXUS AI window over the WebView2
// DevTools Protocol and calls the same `ipc` command the UI calls.
//
//   node tools/m3-gate.mjs
//
// Creates a throw-away folder with one markdown file and 200 bulk files, watches it,
// proves indexing/retrieval/rename, then proves a pending memory is invisible to
// memory.search until it is approved. The folder is unwatched and deleted at the end.
//
// Env: NEXUS_CDP_PORT (default 9333), NEXUS_GATE_OUT (default .m3-gate.json)
//
// Exit code 0 means every step returned what it claims.
import { appendFileSync, writeFileSync, mkdirSync, rmSync, writeFileSync as write } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.NEXUS_CDP_PORT || 9333);
const OUT = process.env.NEXUS_GATE_OUT || join(ROOT, '.m3-gate.json');
const TREE = join(ROOT, '.m3-gate-tree');
const DEV_URL = /^https?:\/\/(localhost|127\.0\.0\.1):5173/;
const log = (...a) => console.log(...a);
const evidence = { phase: 'm3', at: new Date().toISOString(), steps: [] };

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await sleep(500);
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
  return page
    .evaluate(
      `(async () => {
         try { return JSON.stringify({ ok: true, data: await window.__TAURI__.core.invoke('ipc', ${payload}) }); }
         catch (e) { return JSON.stringify({ ok: false, error: e && typeof e === 'object' ? e : { code: 'internal', message: String(e) } }); }
       })()`,
    )
    .then((raw) => JSON.parse(raw));
}

/** Same call, but timing measured inside the page around the real invoke. */
function ipcTimed(page, command, args) {
  const payload = JSON.stringify({ command, args: args ?? null });
  return page
    .evaluate(
      `(async () => {
         const started = performance.now();
         try {
           const data = await window.__TAURI__.core.invoke('ipc', ${payload});
           return JSON.stringify({ ok: true, data, ms: performance.now() - started });
         } catch (e) {
           return JSON.stringify({ ok: false, error: e && typeof e === 'object' ? e : { code: 'internal', message: String(e) } });
         }
       })()`,
    )
    .then((raw) => JSON.parse(raw));
}

function prepareTree() {
  rmSync(TREE, { recursive: true, force: true });
  mkdirSync(join(TREE, 'bulk'), { recursive: true });
  write(
    join(TREE, 'admission.md'),
    [
      '# Admission',
      '',
      'Admission is measured, not guessed: private memory is roughly 1495 MB plus',
      '0.1106 MB per token. The cedar admission note records that cap.',
      '',
      '# Windows quoting',
      '',
      'PowerShell reports a RemoteException while cargo actually succeeded.',
      '',
    ].join('\n'),
  );
  for (let i = 0; i < 200; i += 1) {
    write(
      join(TREE, 'bulk', `filler-${String(i).padStart(3, '0')}.md`),
      `# Filler ${i}\n\nGeneric filler document number ${i} about unrelated notes and lists.\n`,
    );
  }
}

/** Remove rows left behind by an earlier aborted run so totals are deterministic. */
async function clearIndex(page) {
  const list = await ipc(page, 'kb.listDocuments', { limit: 500 });
  if (!list.ok) return;
  for (const doc of list.data.items) {
    if (typeof doc.path === 'string' && doc.path.startsWith(TREE)) {
      await ipc(page, 'kb.deleteDocument', { id: doc.id });
    }
  }
}

const run = async () => {
  writeFileSync(OUT, '');
  prepareTree();
  record('fixture tree written', true, `1 document + 200 bulk files under ${TREE}`);

  const page = await connect((await findPage()).webSocketDebuggerUrl);
  try {
    const handshake = await ipc(page, 'engine.status');
    record('the page reaches the real core', handshake.ok, handshake.ok ? 'engine.status answered' : handshake.error?.code);

    await clearIndex(page);

    const watched = await ipc(page, 'kb.watchRoot', { path: TREE });
    record(
      'kb.watchRoot accepted the folder',
      watched.ok,
      watched.ok ? watched.data.root : `${watched.error?.code}: ${watched.error?.message} ${watched.error?.detail ?? ''}`,
    );

    // The scan is synchronous inside kb.watchRoot, but indexing continues per file in the
    // same call — poll until the markdown file reports chunks, never a fixed sleep.
    let listing = null;
    let doc = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      listing = await ipc(page, 'kb.listDocuments', { limit: 500 });
      doc = listing.ok ? listing.data.items.find((d) => d.name === 'admission.md') : null;
      if (doc && doc.indexed === 'indexed' && (doc.chunkCount ?? 0) > 0) break;
      await sleep(500);
    }
    record(
      'the dropped markdown file reached indexed with a real chunk count',
      Boolean(doc && doc.indexed === 'indexed' && doc.chunkCount > 0),
      doc ? `${doc.name} · ${doc.indexed} · ${doc.chunkCount} chunks` : 'admission.md not listed',
    );
    record('the whole tree was indexed', Boolean(listing?.ok) && listing.data.total >= 201, `total ${listing?.ok ? listing.data.total : '?'}`);

    const search = await ipcTimed(page, 'kb.search', { query: 'cedar admission private memory measured', maxResults: 4 });
    const hits = search.ok ? search.data.items ?? [] : [];
    const cited = hits.some((h) => typeof h.citation === 'string' && h.citation.includes('admission.md'));
    record('kb.search returns the document with a citation', cited, hits[0]?.citation ?? search.error?.code);
    record('kb.search reports vectors as measured', search.ok && search.data.measured === true, String(search.ok && search.data.measured));
    record(
      'kb.search over 201 documents is sub-second',
      search.ok && search.ms < 1000,
      `${search.ok ? search.ms.toFixed(2) : '?'} ms`,
    );

    // Rename on disk: the watcher must update the row rather than insert a second one.
    const { renameSync } = await import('node:fs');
    renameSync(join(TREE, 'admission.md'), join(TREE, 'admission-renamed.md'));
    let renamed = false;
    let totalAfter = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const again = await ipc(page, 'kb.listDocuments', { limit: 500 });
      if (again.ok) {
        totalAfter = again.data.total;
        renamed = again.data.items.some((d) => d.name === 'admission-renamed.md');
        if (renamed) break;
      }
      await sleep(500);
    }
    record('the watcher noticed the rename', renamed, renamed ? 'admission-renamed.md listed' : 'still admission.md');
    record('the rename did not duplicate the document', totalAfter === 201, `total ${totalAfter}`);

    // Memory gate: an explicit “remember …” is written pending, hidden from retrieval,
    // then visible after approval. chat.send is the real path the UI uses.
    const models = await ipc(page, 'model.list', { installedOnly: true, limit: 10 });
    const modelId = models.ok ? models.data.items[0]?.id : null;
    record('an installed model is available for the chat leg', Boolean(modelId), modelId ?? 'none');

    const created = await ipc(page, 'chat.create', {
      title: 'M3 gate conversation',
      agentId: 'universal',
      modelId: modelId ?? '',
    });
    record('chat.create wrote a conversation', created.ok, created.ok ? created.data.id : created.error?.code);
    const conversationId = created.ok ? created.data.id : '';

    const sent = await ipc(page, 'chat.send', {
      conversationId,
      content: 'remember that the cedar admission note says private memory is measured',
      clientId: `m3-gate-${Date.now()}`,
    });
    record('chat.send answered and reported citations', sent.ok && (sent.data.citations ?? []).length > 0, sent.ok ? `${(sent.data.citations ?? []).length} citations` : sent.error?.code);
    record(
      'the answer cites the indexed document',
      sent.ok && (sent.data.citations ?? []).some((c) => String(c.citation).includes('admission-renamed.md')),
      sent.ok ? (sent.data.citations ?? []).map((c) => c.citation).join(', ') : '',
    );

    const listed = await ipc(page, 'memory.list', { limit: 100 });
    const gateMemories = listed.ok
      ? listed.data.items.filter((m) => m.content.includes('the cedar admission note says private memory is measured'))
      : [];
    const pending = gateMemories.find((m) => m.approval === 'pending') ?? null;
    record('the explicit request became a pending memory', Boolean(pending), pending ? pending.title : 'none');

    const hidden = await ipc(page, 'memory.search', { query: 'cedar admission note', maxResults: 10 });
    record(
      'the pending memory is not retrievable',
      hidden.ok && !(hidden.data.items ?? []).some((m) => pending && m.id === pending.id),
      `${hidden.ok ? hidden.data.items.length : '?'} hits while pending`,
    );

    if (pending) {
      const approved = await ipc(page, 'memory.approve', { id: pending.id });
      record('memory.approve accepted the decision', approved.ok, approved.ok ? 'approved' : approved.error?.code);
      const visible = await ipc(page, 'memory.search', { query: 'cedar admission note', maxResults: 10 });
      record(
        'the approved memory is retrievable',
        visible.ok && (visible.data.items ?? []).some((m) => m.id === pending.id),
        `${visible.ok ? visible.data.items.length : '?'} hits after approval`,
      );
    }

    // The UI paints the real index and the citation chips, not the demo banner.
    await page.evaluate(`location.hash = '#/knowledge'`);
    let knowledgeText = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      knowledgeText = await page.evaluate('document.body.innerText');
      if (knowledgeText.includes('admission-renamed.md') && /index \(measured\)/i.test(knowledgeText)) break;
      await sleep(500);
    }
    record(
      'the Knowledge screen shows the live index',
      knowledgeText.includes('admission-renamed.md') && /index \(measured\)/i.test(knowledgeText),
      knowledgeText.includes('admission-renamed.md') ? 'document listed' : 'document missing',
    );
    record(
      'the Knowledge screen no longer claims to be simulated',
      !/no documents are actually parsed or stored/i.test(knowledgeText),
      'demo notice absent',
    );

    await page.evaluate(`location.hash = '#/chat'`);
    let chatText = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      chatText = await page.evaluate('document.body.innerText');
      if (/sources/i.test(chatText) && chatText.includes('admission-renamed.md')) break;
      await sleep(500);
    }
    record(
      'the Chat screen renders the citation chip for the answer',
      /sources/i.test(chatText) && chatText.includes('admission-renamed.md'),
      /sources/i.test(chatText) ? 'Sources rendered' : 'no Sources row',
    );

    // Clean up: unwatch the fixture, remove its rows, drop the gate conversation and memory.
    await ipc(page, 'kb.unwatchRoot', { path: TREE });
    await clearIndex(page);
    if (conversationId) await ipc(page, 'chat.delete', { id: conversationId });
    for (const m of gateMemories) await ipc(page, 'memory.delete', { id: m.id });
    rmSync(TREE, { recursive: true, force: true });
    log('cleanup  fixture folder removed, gate rows and memory archived');
  } finally {
    page.close();
    evidence.ok = evidence.steps.every((s) => s.ok);
    writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  }
};

run().catch((err) => {
  log(`FAIL  ${err.message}`);
  writeFileSync(OUT, JSON.stringify({ phase: 'm3', error: err.message }, null, 2));
  process.exit(1);
});
