// Tiny JSON-file database. Keeps everything in memory and writes atomically to disk.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DOCS_DIR = path.join(DATA_DIR, 'docs');

fs.mkdirSync(DOCS_DIR, { recursive: true });

let state = { users: [], rooms: [], messages: {} };

if (fs.existsSync(DB_FILE)) {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    console.error('[db] Could not parse db.json, starting fresh:', err.message);
  }
}

let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  if (!saveTimer) saveTimer = setTimeout(writeNow, 300);
}

const db = {
  DATA_DIR,
  DOCS_DIR,
  flush: writeNow,

  // ---- users ----
  findUserByName(username) {
    const u = username.toLowerCase();
    return state.users.find((x) => x.username.toLowerCase() === u) || null;
  },
  findUserById(id) {
    return state.users.find((x) => x.id === id) || null;
  },
  createUser(user) {
    state.users.push(user);
    save();
    return user;
  },

  // ---- rooms ----
  getRoom(id) {
    return state.rooms.find((r) => r.id === id) || null;
  },
  roomsForUser(userId) {
    return state.rooms
      .filter((r) => r.members.includes(userId))
      .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  },
  createRoom(room) {
    state.rooms.push(room);
    save();
    return room;
  },
  updateRoom(id, patch) {
    const room = this.getRoom(id);
    if (!room) return null;
    Object.assign(room, patch);
    save();
    return room;
  },
  addMember(id, userId) {
    const room = this.getRoom(id);
    if (room && !room.members.includes(userId)) {
      room.members.push(userId);
      save();
    }
    return room;
  },
  removeMember(id, userId) {
    const room = this.getRoom(id);
    if (room) {
      room.members = room.members.filter((m) => m !== userId);
      save();
    }
  },
  deleteRoom(id) {
    state.rooms = state.rooms.filter((r) => r.id !== id);
    delete state.messages[id];
    save();
  },

  // ---- chat ----
  getMessages(roomId) {
    return state.messages[roomId] || [];
  },
  addMessage(roomId, msg) {
    const list = state.messages[roomId] || (state.messages[roomId] = []);
    list.push(msg);
    if (list.length > 300) list.splice(0, list.length - 300);
    save();
    return msg;
  },
};

process.on('exit', () => {
  if (saveTimer) writeNow();
});

module.exports = db;
