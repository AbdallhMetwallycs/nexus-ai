// M4 tools-and-approvals gate — drives the running NEXUS AI window over the WebView2
// DevTools Protocol and exercises the same `ipc` command the UI calls.
//
//   node tools/m4-gate.mjs
//
// Proves the milestone's exit lines against the real core: a 3-step Developer Agent task
// completes with one correlation id on every step and activity row; a rejected approval
// stops the task with a visible reason and a second file that is never written; a path
// traversal is denied before any filesystem call; two jobs are serialised; and the
// Activity Center's Approve/Always/Reject controls drive a real decision.
//
// Env: NEXUS_CDP_PORT (default 9333), NEXUS_GATE_OUT (default .m4-gate.json)
//
// Exit code 0 means every step returned what it claims.
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.NEXUS_CDP_PORT || 9333);
const OUT = process.env.NEXUS_GATE_OUT || join(ROOT, '.m4-gate.json');
const TREE = join(ROOT, '.m4-gate-tree');
const NOTES = join(TREE, 'notes');
const STAMP = Date.now();
const FIRST = `gate-one-${STAMP}.txt`;
const DENIED = `gate-denied-${STAMP}.txt`;
const UI_FILE = `gate-ui-${STAMP}.txt`;
const DEV_URL = /^https?:\/\/(localhost|127\.0\.0\.1):5173/;
const log = (...a) => console.log(...a);
const evidence = { phase: 'm4', at: new Date().toISOString(), steps: [] };

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

function prepareTree() {
  rmSync(TREE, { recursive: true, force: true });
  mkdirSync(NOTES, { recursive: true });
  mkdirSync(join(TREE, 'outside'), { recursive: true });
  writeFileSync(join(NOTES, 'seed.md'), '# Seed\n\nA watched note.\n');
  writeFileSync(join(TREE, 'outside', 'secret.txt'), 'must never be read by a tool\n');
}

/** Poll `approval.pending` until a row naming `needle` appears. */
async function waitApproval(page, needle, expect = true) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < 30000) {
    const listed = await ipc(page, 'approval.pending');
    if (listed.ok) {
      last = listed.data;
      const hit = last.find((a) => JSON.stringify(a).includes(needle));
      if (hit) return hit;
    }
    await sleep(250);
  }
  if (!expect) return null;
  throw new Error(`no approval naming ${needle}; pending: ${JSON.stringify(last)}`);
}

/** Poll `job.get` until a terminal status. */
async function waitJob(page, id, timeoutMs = 40000) {
  const start = Date.now();
  let job = null;
  while (Date.now() - start < timeoutMs) {
    const got = await ipc(page, 'job.get', { id });
    if (got.ok) {
      job = got.data;
      if (job.status === 'success' || job.status === 'failure') return job;
    }
    await sleep(250);
  }
  throw new Error(`job ${id} never finished; last ${JSON.stringify(job)}`);
}

async function waitStatus(page, id, status, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const got = await ipc(page, 'job.get', { id });
    if (got.ok && got.data.status === status) return got.data;
    await sleep(250);
  }
  throw new Error(`job ${id} never reached ${status}`);
}

/** Call a plan and return the job id. */
async function runPlan(page, plan) {
  const queued = await ipc(page, 'agent.run', { agentId: 'developer-agent', input: plan });
  if (!queued.ok) throw new Error(`agent.run refused: ${queued.error?.code} ${queued.error?.message}`);
  return queued.data.jobId;
}

async function activityForJob(page, job) {
  const listed = await ipc(page, 'activity.list', { limit: 200 });
  if (!listed.ok) return [];
  return listed.data.items.filter((e) => e.jobId === job.id);
}

const run = async () => {
  writeFileSync(OUT, '');
  prepareTree();
  record('fixture tree written', true, `${NOTES} plus a secret file outside it`);

  const page = await connect((await findPage()).webSocketDebuggerUrl);
  try {
    const handshake = await ipc(page, 'engine.status');
    record('the page reaches the real core', handshake.ok, handshake.ok ? 'engine.status answered' : handshake.error?.code);

    const agents = await ipc(page, 'agent.list', {});
    const developer = agents.ok ? agents.data.items.find((a) => a.id === 'developer-agent') : null;
    record('the Developer Agent exists and is enabled', Boolean(developer?.enabled), developer ? developer.name : 'missing');

    const tools = await ipc(page, 'tool.list', {});
    const write = tools.ok ? tools.data.items.find((t) => t.id === 'fs.write') : null;
    record(
      'the tool catalogue records fs.write as approval-gated',
      Boolean(write && write.needsApproval && write.enabled),
      write ? `${write.name} · needsApproval=${write.needsApproval}` : 'missing',
    );

    const watched = await ipc(page, 'kb.watchRoot', { path: NOTES });
    record('kb.watchRoot accepted the fixture as a tool root', watched.ok, watched.ok ? watched.data.root : watched.error?.code);

    // ---- Line 1: a 3-step task completes; one correlation id across steps and log ----
    const plan = [
      `fs.list ${NOTES}`,
      `fs.write ${NOTES}/${FIRST} | NEXUS M4 GATE OK`,
      `fs.read "${NOTES}/${FIRST}"`,
    ].join('\n');
    const jobId = await runPlan(page, plan);
    const approval = await waitApproval(page, FIRST);
    record(
      'the write step asked before acting, in plain language',
      /Write \d+ bytes to/i.test(approval.summary),
      approval.summary,
    );
    const parked = await ipc(page, 'job.get', { id: jobId });
    record(
      'the job is parked in the queue while the decision waits',
      parked.ok && parked.data.status === 'queued' && parked.data.steps[1].status === 'awaiting_approval',
      parked.ok ? `${parked.data.status} / step ${parked.data.steps[1].status}` : parked.error?.code,
    );
    const decided = await ipc(page, 'approval.decide', { id: approval.id, approved: true, scope: 'once' });
    record('approval.decide accepted the approval', decided.ok, decided.ok ? 'approved once' : decided.error?.code);

    const done = await waitJob(page, jobId);
    record('the three-step task completed', done.status === 'success' && done.steps.every((s) => s.status === 'success'), done.status);
    record(
      'fs.read returned what fs.write wrote',
      String(done.steps[2]?.output ?? '').includes('NEXUS M4 GATE OK'),
      String(done.steps[2]?.output ?? '').slice(0, 80),
    );
    const correlation = done.correlationId;
    record(
      'every step carries the job correlation id',
      Boolean(correlation) && done.steps.every((s) => s.correlationId === correlation),
      correlation,
    );
    const events = await activityForJob(page, done);
    record(
      'every activity row for the job carries the same correlation id',
      events.length >= 5 && events.every((e) => e.correlationId === correlation),
      `${events.length} rows`,
    );
    record(
      'the activity log names the start, the tool calls and the finish',
      ['Job started', 'Job finished'].every((t) => events.some((e) => e.title === t)) &&
        events.filter((e) => e.kind === 'tool').length >= 3,
      events.map((e) => e.title).join(' · '),
    );

    // ---- Line 2: denying an approval stops the task with a visible reason ----
    const denyJob = await runPlan(page, [
      `fs.write ${NOTES}/${DENIED} | never`,
      `fs.list ${NOTES}`,
    ].join('\n'));
    const denyApproval = await waitApproval(page, DENIED);
    const rejected = await ipc(page, 'approval.decide', { id: denyApproval.id, approved: false });
    record('approval.decide accepted the rejection', rejected.ok, rejected.ok ? 'rejected' : rejected.error?.code);
    const stopped = await waitJob(page, denyJob);
    record(
      'the task stopped with a visible reason rather than a silent partial',
      stopped.status === 'failure' &&
        /rejected/i.test(String(stopped.error ?? '')) &&
        /Nothing ran/i.test(String(stopped.error ?? '')),
      stopped.error ?? 'no error',
    );
    record(
      'the denied step is marked and the second step never ran',
      stopped.steps[0].status === 'denied' && stopped.steps[1].status === 'pending',
      `${stopped.steps[0].status} / ${stopped.steps[1].status}`,
    );
    const fs = await import('node:fs');
    record('the rejected write left no file behind', !fs.existsSync(join(NOTES, DENIED)), join(NOTES, DENIED));

    // ---- Line 3: traversal is denied by policy, not offered as a question ----
    const before = (await ipc(page, 'approval.pending')).data ?? [];
    const escapeJob = await runPlan(page, `fs.read "${join(TREE, 'outside', 'secret.txt')}"`);
    const refused = await waitJob(page, escapeJob);
    const escapeEvents = await activityForJob(page, refused);
    record(
      'a path outside every watched folder is denied before any read',
      refused.status === 'failure' &&
        refused.steps[0].status === 'denied' &&
        !String(refused.steps[0].output ?? '').includes('must never'),
      refused.steps[0].error ?? refused.error ?? 'no error',
    );
    record(
      'the denial is recorded as policy.root_denied',
      escapeEvents.some((e) => String(e.detail).includes('policy.root_denied')),
      escapeEvents.map((e) => e.detail).join(' | ').slice(0, 120),
    );
    const after = (await ipc(page, 'approval.pending')).data ?? [];
    record(
      'a traversal does not ask the owner; no approval was created',
      after.length === before.length,
      `${before.length} before, ${after.length} after`,
    );

    // ---- Line 4: two simultaneous jobs are serialised and both are visible ----
    const a = await runPlan(page, `fs.list ${NOTES}`);
    const b = await runPlan(page, `fs.list ${NOTES}`);
    const [jobA, jobB] = await Promise.all([waitJob(page, a), waitJob(page, b)]);
    record('both queued jobs completed', jobA.status === 'success' && jobB.status === 'success', `${jobA.status} / ${jobB.status}`);
    const [firstDone, firstStarted] =
      jobA.finishedAt <= jobB.startedAt
        ? [jobA.finishedAt, jobB.startedAt]
        : [jobB.finishedAt, jobA.startedAt];
    record(
      'the single slot serialised them: one finished before the other started',
      firstDone <= firstStarted,
      `${firstDone} <= ${firstStarted}`,
    );
    const listedJobs = await ipc(page, 'job.list', { limit: 20 });
    record(
      'job.list shows the queue as the Activity Center reads it',
      listedJobs.ok && listedJobs.data.some((j) => j.id === a) && listedJobs.data.some((j) => j.id === b),
      `${listedJobs.ok ? listedJobs.data.length : '?'} jobs`,
    );

    // ---- UI honesty: Tools and Agents paint live data, not demo banners ----
    await page.evaluate(`location.hash = '#/tools'`);
    let toolsText = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      toolsText = await page.evaluate('document.body.innerText');
      if (/Write file/i.test(toolsText)) break;
      await sleep(400);
    }
    record('the Tools screen lists the live catalogue', /Write file/i.test(toolsText) && /approval required/i.test(toolsText), 'fs.write listed');
    record(
      'the Tools screen no longer claims to be simulated',
      !/tools show simulated status/i.test(toolsText) && !/no commands are executed/i.test(toolsText),
      'demo notice absent',
    );

    await page.evaluate(`location.hash = '#/agents'`);
    let agentsText = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      agentsText = await page.evaluate('document.body.innerText');
      if (/developer agent/i.test(agentsText)) break;
      await sleep(400);
    }
    record('the Agents screen lists the stored roster', /developer agent/i.test(agentsText), 'Developer Agent listed');
    record(
      'the Agents screen no longer claims to be mock definitions',
      !/mock definitions/i.test(agentsText),
      'demo notice absent',
    );

    // ---- UI decision path: queue one write, decide it from the Activity Center ----
    const uiJob = await runPlan(page, `fs.write ${NOTES}/${UI_FILE} | decided in the UI`);
    await waitApproval(page, UI_FILE);

    await page.evaluate(`location.hash = '#/activity'`);
    let activityText = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      activityText = await page.evaluate('document.body.innerText');
      if (activityText.includes(UI_FILE)) break;
      await sleep(400);
    }
    record('the Activity Center shows the pending decision', activityText.includes(UI_FILE), UI_FILE);

    const clicked = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('button')];
      const row = rows.find((b) => b.innerText.includes('Approval requested') && b.innerText.includes(${JSON.stringify(UI_FILE)}));
      if (!row) return 'row not found';
      row.click();
      return 'opened';
    })()`);
    record('the pending row expands to its decision controls', clicked === 'opened', clicked);

    await sleep(400);
    const approvedInUi = await page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const always = buttons.find((b) => /always allow/i.test(b.innerText));
      if (always) { always.click(); return 'always'; }
      const once = buttons.find((b) => /approve once/i.test(b.innerText));
      if (once) { once.click(); return 'once'; }
      return 'no approve control';
    })()`);
    record('the Activity Center offers Approve once / Always allow / Reject', approvedInUi === 'always' || approvedInUi === 'once', approvedInUi);

    let uiDone = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const got = await ipc(page, 'job.get', { id: uiJob });
      if (got.ok && got.data.status === 'success') {
        uiDone = got.data;
        break;
      }
      if (got.ok && got.data.status === 'failure') {
        uiDone = got.data;
        break;
      }
      await sleep(400);
    }
    record('the UI decision resumed and finished the job', uiDone?.status === 'success', uiDone?.status ?? 'still queued');
    record('the approved write exists on disk', fs.existsSync(join(NOTES, UI_FILE)), join(NOTES, UI_FILE));
    if (approvedInUi === 'always') {
      const grants = await ipc(page, 'tool.grants', { id: 'fs.write' });
      record(
        'Always allow created a visible standing grant',
        grants.ok && grants.data.standing.some((g) => g.permission === 'fs.write' && g.scope === 'always'),
        grants.ok ? JSON.stringify(grants.data.standing) : grants.error?.code,
      );
      // Leave the machine as we found it: the standing grant was the gate's own action.
      await ipc(page, 'tool.setGrant', { id: 'fs.write', permission: 'fs.write', scope: 'never' });
    }

    // Cleanup: stop watching the fixture and remove its documents.
    await ipc(page, 'kb.unwatchRoot', { path: NOTES });
    const docs = await ipc(page, 'kb.listDocuments', { limit: 500 });
    if (docs.ok) {
      for (const doc of docs.data.items) {
        if (typeof doc.path === 'string' && doc.path.startsWith(TREE)) {
          await ipc(page, 'kb.deleteDocument', { id: doc.id });
        }
      }
    }
    rmSync(TREE, { recursive: true, force: true });
    log('cleanup  fixture folder unwatched and removed');
  } finally {
    page.close();
    evidence.ok = evidence.steps.every((s) => s.ok);
    writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  }
};

run().catch((err) => {
  log(`FAIL  ${err.message}`);
  writeFileSync(OUT, JSON.stringify({ phase: 'm4', error: err.message }, null, 2));
  process.exit(1);
});
