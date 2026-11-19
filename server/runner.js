// Runs code on the server machine. All files of the room are written to a temp
// folder so that multi-file projects (imports / requires) work.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 10000);
const COMPILE_TIMEOUT_MS = 30000;
const MAX_OUTPUT = 200 * 1024; // bytes

const which = (cmd, args) => {
  try {
    const r = spawnSync(cmd, args, { timeout: 5000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
};

const LANGS = {
  js: {
    name: 'JavaScript (Node.js)',
    available: () => true,
    steps: (f) => [{ cmd: process.execPath, args: [f] }],
  },
  py: {
    name: 'Python 3',
    available: () => which('python3', ['--version']),
    steps: (f) => [{ cmd: 'python3', args: ['-u', f] }],
  },
  c: {
    name: 'C (gcc)',
    available: () => which('gcc', ['--version']),
    steps: (f) => [
      { cmd: 'gcc', args: [f, '-o', 'program', '-lm'], compile: true },
      { cmd: './program', args: [] },
    ],
  },
  cpp: {
    name: 'C++17 (g++)',
    available: () => which('g++', ['--version']),
    steps: (f) => [
      { cmd: 'g++', args: ['-std=c++17', '-O2', f, '-o', 'program'], compile: true },
      { cmd: './program', args: [] },
    ],
  },
  java: {
    name: 'Java',
    available: () => which('java', ['-version']),
    steps: (f) => [{ cmd: 'java', args: [f] }],
  },
  rb: {
    name: 'Ruby',
    available: () => which('ruby', ['--version']),
    steps: (f) => [{ cmd: 'ruby', args: [f] }],
  },
};
LANGS.cc = LANGS.cpp;
LANGS.mjs = LANGS.js;

// Detect which runtimes exist on this machine once at startup.
const AVAILABLE = {};
for (const [ext, lang] of Object.entries(LANGS)) AVAILABLE[ext] = lang.available();

function runtimes() {
  return Object.entries(LANGS)
    .filter(([ext]) => !['cc', 'mjs'].includes(ext))
    .map(([ext, l]) => ({ ext, name: l.name, available: AVAILABLE[ext] }));
}

const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
const safeName = (name) => path.basename(String(name)).replace(/[^\w.\-]/g, '_');

/**
 * Run `entry` (a file name) from `files`.
 * Calls onOutput(stream, text) as output arrives. Returns { promise, stop() }.
 */
function runCode({ files, entry, stdin = '' }, onOutput) {
  const ext = extOf(entry);
  const lang = LANGS[ext];
  if (!lang) {
    return { promise: Promise.resolve({ code: 1, error: `Don't know how to run ".${ext}" files. Supported: .js .py .c .cpp .java .rb` }), stop() {} };
  }
  if (!AVAILABLE[ext]) {
    return { promise: Promise.resolve({ code: 1, error: `${lang.name} is not installed on the server machine.` }), stop() {} };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codyvibes-'));
  for (const f of files) fs.writeFileSync(path.join(dir, safeName(f.name)), f.content);

  let child = null;
  let stopped = false;
  let outBytes = 0;

  const emit = (stream, data) => {
    if (outBytes >= MAX_OUTPUT) return;
    let text = data.toString();
    outBytes += Buffer.byteLength(text);
    if (outBytes >= MAX_OUTPUT) {
      text += '\n[output truncated: limit reached]\n';
      killChild();
    }
    onOutput(stream, text);
  };

  function killChild() {
    if (!child || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGKILL'); // kill the whole process group
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }

  const runStep = (step) =>
    new Promise((resolve) => {
      const timeout = step.compile ? COMPILE_TIMEOUT_MS : RUN_TIMEOUT_MS;
      child = spawn(step.cmd, step.args, {
        cwd: dir,
        detached: process.platform !== 'win32',
        env: { PATH: process.env.PATH, HOME: dir, LANG: 'en_US.UTF-8', PYTHONIOENCODING: 'utf-8' },
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeout);
      child.stdout.on('data', (d) => emit('stdout', d));
      child.stderr.on('data', (d) => emit('stderr', d));
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: 1, error: err.message });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, signal, timedOut });
      });
      if (!step.compile) {
        child.stdin.on('error', () => {});
        child.stdin.end(stdin.endsWith('\n') || !stdin ? stdin : stdin + '\n');
      } else child.stdin.end();
    });

  const promise = (async () => {
    const started = Date.now();
    const file = safeName(entry);
    let result = { code: 0 };
    try {
      for (const step of lang.steps(file)) {
        if (stopped) break;
        result = await runStep(step);
        if (result.timedOut) {
          result.error = `Time limit exceeded (${(step.compile ? COMPILE_TIMEOUT_MS : RUN_TIMEOUT_MS) / 1000}s)`;
          break;
        }
        if (result.code !== 0 || result.error) break;
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (stopped) result = { ...result, error: 'Stopped by user' };
    return { ...result, durationMs: Date.now() - started };
  })();

  return {
    promise,
    stop() {
      stopped = true;
      killChild();
    },
  };
}

module.exports = { runCode, runtimes, extOf };
