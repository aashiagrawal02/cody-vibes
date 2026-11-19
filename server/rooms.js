// Shared document state for each room, built on Yjs (a CRDT), so that many
// people can edit the same files at once without conflicts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');
const db = require('./db');

const live = new Map(); // roomId -> { doc, awareness, saveTimer, unloadTimer }

const docPath = (roomId) => path.join(db.DOCS_DIR, `${roomId.replace(/[^a-zA-Z0-9_-]/g, '')}.bin`);
const newId = () => crypto.randomBytes(6).toString('hex');

function saveDoc(roomId) {
  const entry = live.get(roomId);
  if (!entry) return;
  clearTimeout(entry.saveTimer);
  entry.saveTimer = null;
  const file = docPath(roomId);
  fs.writeFileSync(file + '.tmp', Buffer.from(Y.encodeStateAsUpdate(entry.doc)));
  fs.renameSync(file + '.tmp', file);
}

/**
 * Returns the live Y.Doc + Awareness for a room, loading it from disk if needed.
 * `onDocUpdate` / `onAwarenessUpdate` are attached once, when the room is loaded.
 */
function getLiveRoom(roomId, hooks = {}) {
  let entry = live.get(roomId);
  if (entry) {
    clearTimeout(entry.unloadTimer);
    return entry;
  }
  const doc = new Y.Doc();
  const file = docPath(roomId);
  if (fs.existsSync(file)) Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)));

  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // the server itself is not a participant

  entry = { doc, awareness, saveTimer: null, unloadTimer: null };
  live.set(roomId, entry);

  doc.on('update', (update, origin) => {
    if (!entry.saveTimer) entry.saveTimer = setTimeout(() => saveDoc(roomId), 1000);
    hooks.onDocUpdate?.(update, origin);
  });
  awareness.on('update', (changes, origin) => hooks.onAwarenessUpdate?.(changes, origin));
  return entry;
}

/** Called when the last person leaves a room: save it and free memory a bit later. */
function scheduleUnload(roomId) {
  const entry = live.get(roomId);
  if (!entry) return;
  saveDoc(roomId);
  clearTimeout(entry.unloadTimer);
  entry.unloadTimer = setTimeout(() => {
    saveDoc(roomId);
    entry.awareness.destroy();
    entry.doc.destroy();
    live.delete(roomId);
  }, 60 * 1000);
}

/** Create the document for a brand-new room using starter files. */
function initRoomDoc(roomId, files) {
  const doc = new Y.Doc();
  const meta = doc.getMap('files');
  doc.transact(() => {
    files.forEach((f, i) => {
      const id = newId();
      meta.set(id, { name: f.name, createdAt: Date.now() + i });
      doc.getText('f:' + id).insert(0, f.content);
    });
  });
  fs.writeFileSync(docPath(roomId), Buffer.from(Y.encodeStateAsUpdate(doc)));
  doc.destroy();
}

/** Plain list of { id, name, content } for the room's files. */
function listFiles(doc) {
  const out = [];
  doc.getMap('files').forEach((meta, id) => {
    out.push({ id, name: meta.name, createdAt: meta.createdAt || 0, content: doc.getText('f:' + id).toString() });
  });
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Read files of a room whether it's currently loaded or not. */
function readRoomFiles(roomId) {
  const entry = live.get(roomId);
  if (entry) return listFiles(entry.doc);
  const doc = new Y.Doc();
  const file = docPath(roomId);
  if (fs.existsSync(file)) Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)));
  const files = listFiles(doc);
  doc.destroy();
  return files;
}

function deleteRoomDoc(roomId) {
  const entry = live.get(roomId);
  if (entry) {
    clearTimeout(entry.saveTimer);
    clearTimeout(entry.unloadTimer);
    entry.awareness.destroy();
    entry.doc.destroy();
    live.delete(roomId);
  }
  fs.rmSync(docPath(roomId), { force: true });
}

function saveAll() {
  for (const id of live.keys()) saveDoc(id);
}

module.exports = { Y, awarenessProtocol, getLiveRoom, scheduleUnload, initRoomDoc, listFiles, readRoomFiles, deleteRoomDoc, saveAll };
