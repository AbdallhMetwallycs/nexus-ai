// Copies the llama.cpp CPU engine that ships inside the NSIS installer.
//
// The development build folder (`D:\NEXUS-SIDECAR\b12189`) contains every tool llama.cpp
// ships — cli, bench, quantize, the vision CLIs. The app needs exactly the process it
// spawns plus the DLLs that process loads, so this script copies a pinned list instead of
// the whole folder, then proves the staged copy runs by asking it for its version.
//
// Usage (from the repo root):
//
//   node tools/stage-engine.mjs
//   NEXUS_ENGINE_DIR=D:\some\other\build node tools/stage-engine.mjs
//
// Output: src-tauri/resources/engine/ (gitignored) + STAGING.json inside it, which
// records the build string, the byte size and the SHA-256 of every staged file. The
// installer bundles that folder as `$RESOURCE/engine`, which is where
// `nexus_core::dispatch::default_engine_dir` looks first after `NEXUS_ENGINE_DIR`.
//
// Exit code 0 means every required file was found and the staged llama-server reported a
// version. The staging folder is wiped first, so a stale DLL cannot survive a re-run.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.env.NEXUS_ENGINE_DIR ?? 'D:\\NEXUS-SIDECAR\\b12189');
const target = resolve(repoRoot, 'src-tauri', 'resources', 'engine');

// Files `llama-server.exe` (a 9.7 kB launcher) loads from its own folder. Verified by
// running the copy with every other DLL in the build folder removed: the server prints
// its version and exits 0 (TEST_RESULTS.md, M6 packaging).
const REQUIRED = [
  'llama-server.exe',
  'llama-server-impl.dll',
  'llama-common.dll',
  'llama.dll',
  'mtmd.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-rpc.dll',
  'libomp.dll',
  'LICENSE-LLVM-OpenMP',
];

// The dispatch loader in ggml picks one of these by CPU model at start-up, so all of them
// ship and none is optional on a machine this build has not seen.
const CPU_VARIANTS = /^ggml-cpu-[a-z0-9]+\.dll$/;

if (!existsSync(source)) {
  console.error(`engine source not found: ${source}`);
  console.error('set NEXUS_ENGINE_DIR to the llama.cpp build folder that holds llama-server.exe');
  process.exit(1);
}

for (const name of REQUIRED) {
  if (!existsSync(join(source, name))) {
    console.error(`missing required engine file: ${join(source, name)}`);
    process.exit(1);
  }
}

const cpuVariants = readdirSync(source).filter((name) => CPU_VARIANTS.test(name)).sort();
if (cpuVariants.length === 0) {
  console.error(`no ggml-cpu-*.dll in ${source}; the engine cannot pick a kernel`);
  process.exit(1);
}

const files = [...REQUIRED, ...cpuVariants];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const staged = [];
let totalBytes = 0;
for (const name of files) {
  const from = join(source, name);
  const to = join(target, name);
  copyFileSync(from, to);
  const bytes = statSync(to).size;
  totalBytes += bytes;
  staged.push({ name, bytes, sha256: sha256(to) });
}

const exe = join(target, 'llama-server.exe');
// llama-server prints its version banner to stderr, so both streams are captured and the
// check is "the process exited 0 and said something", not "stdout was non-empty".
const run = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 60_000 });
const version = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
if (run.error || run.status !== 0 || version === '') {
  console.error(`the staged engine does not run: status=${run.status} ${run.error?.message ?? version}`);
  process.exit(1);
}

const manifest = {
  stagedAt: new Date().toISOString(),
  source,
  version,
  totalBytes,
  files: staged,
};
writeFileSync(join(target, 'STAGING.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`staged ${staged.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB -> ${target}`);
for (const line of version.split(/\r?\n/)) console.log(`  ${line}`);
