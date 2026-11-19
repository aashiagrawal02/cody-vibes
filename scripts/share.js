// `npm run share` — starts Cody Vibes and gives it a public https link using a
// free Cloudflare quick tunnel. The link works while this command keeps running.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || '3000';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const CLOUDFLARED = path.join(ROOT, 'tools', 'cloudflared', 'cloudflared');

if (!fs.existsSync(CLOUDFLARED)) {
  console.error('cloudflared not found at tools/cloudflared/cloudflared. See README → "Share a public link".');
  process.exit(1);
}

// Invite code: keep the same one between runs so friends' codes keep working.
fs.mkdirSync(DATA_DIR, { recursive: true });
const codeFile = path.join(DATA_DIR, 'invite-code.txt');
let inviteCode = process.env.SIGNUP_CODE;
if (!inviteCode) {
  if (fs.existsSync(codeFile)) inviteCode = fs.readFileSync(codeFile, 'utf8').trim();
  if (!inviteCode) {
    inviteCode = 'vibes-' + crypto.randomBytes(3).toString('hex');
    fs.writeFileSync(codeFile, inviteCode);
  }
}

const children = [];
function shutdown(code = 0) {
  children.forEach((c) => c.exitCode === null && c.kill('SIGINT'));
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Check the port first, so "already running" gets a clear message instead of a crash.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = require('net').createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(Number(port));
  });
}

async function main() {
if (!(await portFree(PORT))) {
  console.error(`\n  ✖ Port ${PORT} is already in use: Cody Vibes (or another app) is probably already running.`);
  console.error('    Stop the other copy first (press Ctrl+C in its Terminal window), then run this again.');
  console.error(`    Or use a different port:  PORT=3001 npm run share\n`);
  process.exit(1);
}

// 1) the app server
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT, SIGNUP_CODE: inviteCode },
  stdio: ['ignore', 'inherit', 'inherit'],
});
children.push(server);
server.on('exit', (c) => {
  console.error('Server stopped.');
  shutdown(c || 1);
});

// 2) the tunnel
const tunnel = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { cwd: ROOT });
children.push(tunnel);
let announced = false;
const watch = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !announced) {
    announced = true;
    fs.writeFileSync(path.join(DATA_DIR, 'public-url.txt'), m[0]);
    console.log('\n  ┌──────────────────────────────────────────────────────────────');
    console.log(`  │  🌍 Public link:  ${m[0]}`);
    const required = /^(1|true|yes)$/i.test(process.env.INVITE_REQUIRED || '');
    console.log(`  │  🔑 Invite code:  ${inviteCode}   (${required ? 'needed to sign up' : 'optional, sign-up works without it'})`);
    console.log('  │  Keep this running. Press Ctrl+C to stop sharing.');
    console.log('  └──────────────────────────────────────────────────────────────\n');
  }
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);
tunnel.on('exit', (c) => {
  console.error('Tunnel stopped.');
  shutdown(c || 1);
});
}

main();
