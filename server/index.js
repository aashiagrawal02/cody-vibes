const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const db = require('./db');
const auth = require('./auth');
const rooms = require('./rooms');
const runner = require('./runner');
const TEMPLATES = require('./templates');
const { makeZip } = require('./zip');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------- helpers
const roomKey = (id) => `room:${id}`;
const presence = new Map(); // roomId -> Map(socketId -> publicUser)
const leaveTimers = new Map(); // `${roomId}:${userId}` -> timeout
const runs = new Map(); // roomId -> { running, stop, by, file, output[] }

function onlineUsers(roomId) {
  const m = presence.get(roomId);
  if (!m) return [];
  const uniq = new Map();
  for (const u of m.values()) uniq.set(u.id, u);
  return [...uniq.values()];
}

function roomSummary(room, userId) {
  const owner = db.findUserById(room.ownerId);
  return {
    id: room.id,
    name: room.name,
    language: room.language,
    languageLabel: TEMPLATES[room.language]?.label || room.language,
    owner: auth.publicUser(owner),
    isOwner: room.ownerId === userId,
    createdAt: room.createdAt,
    lastActive: room.lastActive,
    memberCount: room.members.length,
    online: onlineUsers(room.id),
  };
}

function newRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id;
  do {
    const b = crypto.randomBytes(9);
    id = Array.from(b, (x) => chars[x % chars.length]).join('');
    id = `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
  } while (db.getRoom(id));
  return id;
}

function systemMessage(roomId, text) {
  const msg = { id: crypto.randomUUID(), type: 'system', text, at: Date.now() };
  db.addMessage(roomId, msg);
  io.to(roomKey(roomId)).emit('chat:message', msg);
}

// ---------------------------------------------------------------- auth API
const validUsername = (u) => typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,20}$/.test(u);

// Invite code for sign-up. It is OPTIONAL by default: people can sign up without it, but a
// code they do type must be correct. Set INVITE_REQUIRED=1 to make it mandatory again.
const SIGNUP_CODE = process.env.SIGNUP_CODE || '';
const INVITE_REQUIRED = !!SIGNUP_CODE && /^(1|true|yes)$/i.test(process.env.INVITE_REQUIRED || '');
// Public URL written by `npm run share` once the tunnel is up (so invite links never point at localhost).
const PUBLIC_URL_FILE = path.join(db.DATA_DIR, 'public-url.txt');
fs.rmSync(PUBLIC_URL_FILE, { force: true }); // a fresh server has no tunnel yet
function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  try {
    return fs.readFileSync(PUBLIC_URL_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
app.get('/api/config', (req, res) => {
  const user = auth.userFromToken(req.cookies?.[auth.COOKIE]);
  res.json({
    inviteEnabled: !!SIGNUP_CODE,
    inviteRequired: INVITE_REQUIRED,
    publicUrl: publicUrl(),
    // Only logged-in users get the code, so they can pass it to friends inside invite links.
    inviteCode: user && SIGNUP_CODE ? SIGNUP_CODE : null,
  });
});

app.post('/api/auth/signup', (req, res) => {
  const { username, password, inviteCode } = req.body || {};
  const code = String(inviteCode || '').trim();
  if (INVITE_REQUIRED && code !== SIGNUP_CODE) return res.status(403).json({ error: 'Invalid invite code. Ask the room owner for it.' });
  if (SIGNUP_CODE && code && code !== SIGNUP_CODE) return res.status(400).json({ error: "That invite code isn't right. Check it, or leave the box empty (it's optional)." });
  if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, _ . -' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.findUserByName(username)) return res.status(409).json({ error: 'That username is already taken' });
  const user = db.createUser({
    id: crypto.randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    color: auth.randomColor(),
    createdAt: Date.now(),
  });
  auth.setAuthCookie(res, user);
  res.json({ user: auth.publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = typeof username === 'string' ? db.findUserByName(username) : null;
  if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  auth.setAuthCookie(res, user);
  res.json({ user: auth.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(auth.COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = auth.userFromToken(req.cookies?.[auth.COOKIE]);
  res.json({ user: auth.publicUser(user) });
});

// ---------------------------------------------------------------- rooms API
app.get('/api/templates', (req, res) => {
  res.json(Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label })));
});

app.get('/api/runtimes', (req, res) => res.json(runner.runtimes()));

app.get('/api/rooms', auth.requireAuth, (req, res) => {
  res.json(db.roomsForUser(req.user.id).map((r) => roomSummary(r, req.user.id)));
});

app.post('/api/rooms', auth.requireAuth, (req, res) => {
  let { name, language } = req.body || {};
  name = String(name || '').trim().slice(0, 60) || 'Untitled room';
  if (!TEMPLATES[language]) language = 'javascript';
  const id = newRoomId();
  rooms.initRoomDoc(id, TEMPLATES[language].files);
  const room = db.createRoom({
    id,
    name,
    language,
    ownerId: req.user.id,
    members: [req.user.id],
    createdAt: Date.now(),
    lastActive: Date.now(),
  });
  res.json(roomSummary(room, req.user.id));
});

app.get('/api/rooms/:id', auth.requireAuth, (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  db.addMember(room.id, req.user.id); // opening a link joins the room
  res.json(roomSummary(room, req.user.id));
});

app.patch('/api/rooms/:id', auth.requireAuth, (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can rename the room' });
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.updateRoom(room.id, { name });
  io.to(roomKey(room.id)).emit('room:renamed', { name });
  res.json(roomSummary(room, req.user.id));
});

app.delete('/api/rooms/:id', auth.requireAuth, (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.ownerId !== req.user.id) {
    // Non-owners just leave the room (remove it from their dashboard).
    db.removeMember(room.id, req.user.id);
    return res.json({ ok: true, left: true });
  }
  io.to(roomKey(room.id)).emit('room:deleted');
  io.in(roomKey(room.id)).socketsLeave(roomKey(room.id));
  runs.get(room.id)?.stop?.();
  runs.delete(room.id);
  presence.delete(room.id);
  rooms.deleteRoomDoc(room.id);
  db.deleteRoom(room.id);
  res.json({ ok: true });
});

app.get('/api/rooms/:id/download', auth.requireAuth, (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room || !room.members.includes(req.user.id)) return res.status(404).json({ error: 'Room not found' });
  const files = rooms.readRoomFiles(room.id).map((f) => ({ name: f.name, data: Buffer.from(f.content, 'utf8') }));
  const zip = makeZip(files);
  const safe = room.name.replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '-') || 'project';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.zip"`);
  res.send(zip);
});

// ---------------------------------------------------------------- pages
app.use(express.static(PUBLIC, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC, 'dashboard.html')));
app.get('/room/:id', (req, res) => res.sendFile(path.join(PUBLIC, 'room.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.redirect('/'));

// ---------------------------------------------------------------- realtime
io.use((socket, next) => {
  const cookies = auth.parseCookies(socket.request.headers.cookie);
  const user = auth.userFromToken(cookies[auth.COOKIE]);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = auth.publicUser(user);
  next();
});

function liveRoom(roomId) {
  return rooms.getLiveRoom(roomId, {
    onDocUpdate(update, origin) {
      // Send every document change to everyone else in the room.
      if (origin && origin.id && origin.emit) origin.to(roomKey(roomId)).emit('sync:update', update);
      else io.to(roomKey(roomId)).emit('sync:update', update);
    },
    onAwarenessUpdate({ added, updated, removed }, origin) {
      const changed = added.concat(updated, removed);
      if (origin && origin.data) {
        const ids = origin.data.awarenessIds || (origin.data.awarenessIds = new Set());
        added.concat(updated).forEach((id) => ids.add(id));
        removed.forEach((id) => ids.delete(id));
      }
      const { awareness } = liveRoom(roomId);
      const msg = rooms.awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
      if (origin && origin.id && origin.emit) origin.to(roomKey(roomId)).emit('awareness:update', msg);
      else io.to(roomKey(roomId)).emit('awareness:update', msg);
    },
  });
}

io.on('connection', (socket) => {
  const user = socket.data.user;
  let roomId = null;

  socket.on('room:join', ({ roomId: id } = {}, ack) => {
    const room = db.getRoom(id);
    if (!room) return ack?.({ error: 'Room not found' });
    if (roomId && roomId !== id) leave();
    roomId = id;
    db.addMember(id, user.id);
    db.updateRoom(id, { lastActive: Date.now() });

    const { doc, awareness } = liveRoom(id);
    const wasOnline = onlineUsers(id).some((u) => u.id === user.id);
    if (!presence.has(id)) presence.set(id, new Map());
    presence.get(id).set(socket.id, user);
    socket.join(roomKey(id));

    const run = runs.get(id);
    ack?.({
      room: roomSummary(room, user.id),
      state: rooms.Y.encodeStateAsUpdate(doc),
      stateVector: rooms.Y.encodeStateVector(doc),
      awareness: rooms.awarenessProtocol.encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]),
      messages: db.getMessages(id).slice(-150),
      run: run ? { running: run.running, by: run.by, file: run.file, output: run.output, result: run.result } : null,
    });
    io.to(roomKey(id)).emit('presence', onlineUsers(id));
    const leaveKey = `${id}:${user.id}`;
    if (leaveTimers.has(leaveKey)) {
      clearTimeout(leaveTimers.get(leaveKey)); // came back quickly: no "left"/"joined" messages
      leaveTimers.delete(leaveKey);
    } else if (!wasOnline) systemMessage(id, `${user.username} joined the room`);
  });

  socket.on('sync:update', (update) => {
    if (!roomId || !db.getRoom(roomId)) return;
    try {
      rooms.Y.applyUpdate(liveRoom(roomId).doc, new Uint8Array(update), socket);
    } catch (err) {
      console.error('[sync] bad update from', user.username, err.message);
    }
  });

  socket.on('awareness:update', (update) => {
    if (!roomId || !db.getRoom(roomId)) return;
    try {
      rooms.awarenessProtocol.applyAwarenessUpdate(liveRoom(roomId).awareness, new Uint8Array(update), socket);
    } catch (err) {
      console.error('[awareness] bad update', err.message);
    }
  });

  socket.on('chat:send', ({ text } = {}) => {
    if (!roomId || typeof text !== 'string') return;
    text = text.trim().slice(0, 2000);
    if (!text) return;
    const msg = { id: crypto.randomUUID(), type: 'user', user, text, at: Date.now() };
    db.addMessage(roomId, msg);
    io.to(roomKey(roomId)).emit('chat:message', msg);
  });

  socket.on('run:start', ({ fileId, stdin } = {}) => {
    if (!roomId || !db.getRoom(roomId)) return;
    const id = roomId;
    const current = runs.get(id);
    if (current?.running) return socket.emit('run:error', { error: `${current.by.username} is already running code. Wait or stop it.` });

    const files = rooms.listFiles(liveRoom(id).doc);
    const entry = files.find((f) => f.id === fileId);
    if (!entry) return socket.emit('run:error', { error: 'File not found' });

    const state = { running: true, by: user, file: entry.name, output: [], result: null, stop: null };
    runs.set(id, state);
    io.to(roomKey(id)).emit('run:started', { by: user, file: entry.name });

    let outSize = 0;
    const job = runner.runCode({ files, entry: entry.name, stdin: typeof stdin === 'string' ? stdin.slice(0, 100000) : '' }, (stream, text) => {
      outSize += text.length;
      if (outSize < 300000) state.output.push({ stream, text });
      io.to(roomKey(id)).emit('run:output', { stream, text });
    });
    state.stop = job.stop;
    job.promise.then((result) => {
      state.running = false;
      state.result = result;
      io.to(roomKey(id)).emit('run:finished', result);
    });
  });

  socket.on('run:stop', () => {
    if (roomId) runs.get(roomId)?.stop?.();
  });

  function leave() {
    if (!roomId) return;
    const id = roomId;
    roomId = null;
    socket.leave(roomKey(id));
    const ids = socket.data.awarenessIds;
    if (db.getRoom(id) && ids && ids.size) rooms.awarenessProtocol.removeAwarenessStates(liveRoom(id).awareness, [...ids], null);
    socket.data.awarenessIds = new Set();

    const p = presence.get(id);
    if (p) {
      p.delete(socket.id);
      const stillOnline = onlineUsers(id).some((u) => u.id === user.id);
      io.to(roomKey(id)).emit('presence', onlineUsers(id));
      if (!stillOnline && db.getRoom(id)) {
        // Wait a moment so a quick page refresh doesn't spam "left / joined".
        const key = `${id}:${user.id}`;
        clearTimeout(leaveTimers.get(key));
        leaveTimers.set(key, setTimeout(() => {
          leaveTimers.delete(key);
          if (db.getRoom(id) && !onlineUsers(id).some((u) => u.id === user.id)) systemMessage(id, `${user.username} left the room`);
        }, 5000));
      }
      if (p.size === 0) {
        presence.delete(id);
        rooms.scheduleUnload(id);
      }
    }
  }

  socket.on('room:leave', leave);
  socket.on('disconnect', leave);
});

// ---------------------------------------------------------------- start
function shutdown() {
  rooms.saveAll();
  db.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`\n  ✨ Cody Vibes is running at http://localhost:${PORT}\n`);
  const rt = runner.runtimes();
  console.log('  Code runners:', rt.map((r) => `${r.name} ${r.available ? '✔' : '✘'}`).join(' | '), '\n');
});
