import { io } from 'socket.io-client';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { api, currentUser, $, el, avatar, toast, openInviteModal } from './common.js';

const roomId = decodeURIComponent(location.pathname.split('/').pop());
// Send logged-out visitors to sign up, keeping the invite code from the link.
const loginUrl = () => `/?next=${encodeURIComponent(location.pathname)}${new URLSearchParams(location.search).get('invite') ? `&invite=${encodeURIComponent(new URLSearchParams(location.search).get('invite'))}` : ''}`;

// ------------------------------------------------------------------ boot
const me = await currentUser();
if (!me) {
  location.href = loginUrl();
  throw new Error('redirecting');
}

if (location.search) history.replaceState(null, '', location.pathname);

let room;
try {
  room = await api(`/api/rooms/${encodeURIComponent(roomId)}`);
} catch (err) {
  $('#loading-text').innerHTML = `${err.message}. <a href="/dashboard">Back to dashboard</a>`;
  $('.spin-logo').classList.remove('spin-logo');
  throw err;
}

// ------------------------------------------------------------------ shared state (Yjs)
const ydoc = new Y.Doc();
const filesMap = ydoc.getMap('files'); // fileId -> { name, createdAt }
const awareness = new awarenessProtocol.Awareness(ydoc);
awareness.setLocalStateField('user', { id: me.id, name: me.username, color: me.color, colorLight: me.color + '33' });

const socket = io({ transports: ['websocket', 'polling'] });

ydoc.on('update', (update, origin) => {
  if (origin !== 'remote' && socket.connected) socket.emit('sync:update', update);
});
awareness.on('update', ({ added, updated, removed }, origin) => {
  if (origin === 'remote' || !socket.connected) return;
  socket.emit('awareness:update', awarenessProtocol.encodeAwarenessUpdate(awareness, added.concat(updated, removed)));
});
window.addEventListener('beforeunload', () => awarenessProtocol.removeAwarenessStates(awareness, [ydoc.clientID], 'unload'));

let joinedOnce = false;
socket.on('connect', () => {
  setConn('online');
  socket.emit('room:join', { roomId }, (res) => {
    if (res.error) {
      $('#loading-text').innerHTML = `${res.error}. <a href="/dashboard">Back to dashboard</a>`;
      return;
    }
    room = res.room;
    Y.applyUpdate(ydoc, new Uint8Array(res.state), 'remote');
    // Push anything we typed while offline.
    const diff = Y.encodeStateAsUpdate(ydoc, new Uint8Array(res.stateVector));
    if (diff.length > 2) socket.emit('sync:update', diff);
    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(res.awareness), 'remote');
    socket.emit('awareness:update', awarenessProtocol.encodeAwarenessUpdate(awareness, [ydoc.clientID]));

    renderChatHistory(res.messages);
    restoreRun(res.run);
    renderRoomHeader();
    if (!joinedOnce) {
      joinedOnce = true;
      $('#loading').classList.add('hidden');
      openInitialFile();
    }
  });
});
socket.on('disconnect', () => setConn('offline'));
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') location.href = loginUrl();
  setConn('offline');
});
socket.on('sync:update', (u) => Y.applyUpdate(ydoc, new Uint8Array(u), 'remote'));
socket.on('awareness:update', (u) => awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(u), 'remote'));
socket.on('presence', (users) => renderPeople(users));
socket.on('room:renamed', ({ name }) => {
  room.name = name;
  renderRoomHeader();
});
socket.on('room:deleted', () => {
  alert('This room was deleted by its owner.');
  location.href = '/dashboard';
});

function setConn(state) {
  const c = $('#conn');
  c.className = `conn ${state}`;
  c.querySelector('.conn-text').textContent = state === 'online' ? 'Live' : 'Reconnecting…';
}

// ------------------------------------------------------------------ header
function renderRoomHeader() {
  document.title = `${room.name} · Cody Vibes`;
  $('#room-name').textContent = room.name;
  $('#room-name').title = room.isOwner ? 'Click to rename' : room.name;
  $('#room-code').textContent = room.id;
  $('#download').href = `/api/rooms/${room.id}/download`;
}
$('#room-name').addEventListener('click', async () => {
  if (!room.isOwner) return;
  const name = prompt('Rename room', room.name);
  if (!name || !name.trim()) return;
  try {
    await api(`/api/rooms/${room.id}`, { method: 'PATCH', body: { name } });
  } catch (err) {
    toast(err.message, 'error');
  }
});
const showInvite = () => openInviteModal(room);
$('#room-code').addEventListener('click', showInvite);
$('#invite').addEventListener('click', showInvite);

// ------------------------------------------------------------------ files
const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
const FILE_ICONS = { js: '🟨', mjs: '🟨', ts: '🟦', py: '🐍', c: '🔵', cpp: '🔷', cc: '🔷', h: '🔹', hpp: '🔹', java: '☕', rb: '💎', html: '🌐', css: '🎨', json: '🧾', md: '📝', txt: '📄' };
const RUNNABLE = ['js', 'mjs', 'py', 'c', 'cpp', 'cc', 'java', 'rb'];

function languageFor(name) {
  switch (extOf(name)) {
    case 'js': case 'mjs': case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'py': return python();
    case 'c': case 'h': case 'cpp': case 'cc': case 'hpp': return cpp();
    case 'java': return java();
    case 'html': case 'htm': return html();
    case 'css': return css();
    case 'json': return json();
    case 'md': return markdown();
    default: return [];
  }
}

function sortedFiles() {
  const out = [];
  filesMap.forEach((meta, id) => out.push({ id, ...meta }));
  return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
const findByName = (name) => sortedFiles().find((f) => f.name.toLowerCase() === name.toLowerCase());

function validateName(name, exceptId) {
  if (!name) return 'Enter a file name';
  if (!/^[\w\-. ]{1,60}$/.test(name)) return 'Use letters, numbers, spaces, - _ and .';
  if (!name.includes('.')) return 'Add an extension, e.g. main.py';
  const dup = findByName(name);
  if (dup && dup.id !== exceptId) return 'A file with that name already exists';
  return null;
}

let currentFileId = null;
let view = null;
let editingName = null; // { id | 'new' }

function renderFiles(force = false) {
  const list = $('#file-list');
  // Don't wipe the name box while someone is typing a file name.
  if (!force && editingName && list.querySelector('input')) return;
  const viewers = viewersByFile();
  const items = sortedFiles().map((f) => {
    if (editingName === f.id) return nameInput(f.name, (name) => renameFile(f.id, name));
    const dots = (viewers.get(f.id) || []).filter((u) => u.id !== me.id).map((u) => el('span', { class: 'mini-dot', style: `background:${u.color}`, title: `${u.name} is here` }));
    return el(
      'li',
      { class: `file-item ${f.id === currentFileId ? 'active' : ''}`, onclick: () => openFile(f.id), ondblclick: () => startRename(f.id) },
      el('span', { class: 'file-icon' }, FILE_ICONS[extOf(f.name)] || '📄'),
      el('span', { class: 'file-name' }, f.name),
      el('span', { class: 'file-dots' }, dots),
      el(
        'span',
        { class: 'file-actions' },
        el('button', { class: 'icon-btn tiny', title: 'Rename', onclick: (e) => { e.stopPropagation(); startRename(f.id); } }, '✎'),
        el('button', { class: 'icon-btn tiny', title: 'Delete', onclick: (e) => { e.stopPropagation(); deleteFile(f.id); } }, '🗑')
      )
    );
  });
  if (editingName === 'new') items.push(nameInput('', createFile));
  list.replaceChildren(...items);
  list.querySelector('input')?.focus();
}

function nameInput(value, onDone) {
  const input = el('input', { class: 'file-input', value, placeholder: 'filename.ext', maxlength: 60 });
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== value) {
      if (onDone(name) === false) {
        done = false;
        return;
      }
    }
    editingName = null;
    renderFiles(true);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      finish(e.key === 'Enter');
    }
  });
  input.addEventListener('blur', () => finish(true));
  setTimeout(() => {
    const dot = value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  });
  return el('li', { class: 'file-item editing' }, input);
}

function createFile(name) {
  const err = validateName(name);
  if (err) {
    toast(err, 'error');
    return false;
  }
  const id = Math.random().toString(16).slice(2, 14);
  ydoc.transact(() => filesMap.set(id, { name, createdAt: Date.now() }));
  editingName = null;
  openFile(id);
}

function renameFile(id, name) {
  const err = validateName(name, id);
  if (err) {
    toast(err, 'error');
    return false;
  }
  const meta = filesMap.get(id);
  if (meta) filesMap.set(id, { ...meta, name });
  if (id === currentFileId) openFile(id); // refresh syntax highlighting
}

function startRename(id) {
  editingName = id;
  renderFiles(true);
}

function deleteFile(id) {
  const meta = filesMap.get(id);
  if (!meta || !confirm(`Delete ${meta.name} for everyone?`)) return;
  ydoc.transact(() => {
    const text = ydoc.getText('f:' + id);
    text.delete(0, text.length);
    filesMap.delete(id);
  });
}

$('#new-file').addEventListener('click', () => {
  editingName = 'new';
  renderFiles(true);
});
$('#no-file-create').addEventListener('click', () => {
  editingName = 'new';
  renderFiles(true);
});

filesMap.observe(() => {
  if (currentFileId && !filesMap.has(currentFileId)) {
    const first = sortedFiles()[0];
    if (first) openFile(first.id);
    else closeEditor();
  } else if (currentFileId) {
    $('#current-file').textContent = filesMap.get(currentFileId).name;
  } else if (joinedOnce && filesMap.size) {
    openInitialFile();
  }
  renderFiles();
});

// ------------------------------------------------------------------ editor
const lastFileKey = `cv:last:${roomId}`;

function openInitialFile() {
  const files = sortedFiles();
  let last = null;
  try {
    last = localStorage.getItem(lastFileKey);
  } catch {}
  const target = files.find((f) => f.id === last) || files[0];
  if (target) openFile(target.id);
  else closeEditor();
  renderFiles();
}

function closeEditor() {
  view?.destroy();
  view = null;
  currentFileId = null;
  awareness.setLocalStateField('fileId', null);
  $('#editor').classList.add('hidden');
  $('#no-file').classList.remove('hidden');
  $('#current-file').textContent = '—';
}

function openFile(id) {
  const meta = filesMap.get(id);
  if (!meta) return;
  currentFileId = id;
  try {
    localStorage.setItem(lastFileKey, id);
  } catch {}
  awareness.setLocalStateField('cursor', null);
  awareness.setLocalStateField('fileId', id);

  const ytext = ydoc.getText('f:' + id);
  const undoManager = new Y.UndoManager(ytext);
  view?.destroy();
  $('#editor').classList.remove('hidden');
  $('#no-file').classList.add('hidden');
  view = new EditorView({
    parent: $('#editor'),
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap, indentWithTab, { key: 'Mod-Enter', run: () => (runCurrent(), true) }, { key: 'Mod-s', run: () => (toast('Everything is saved automatically ✨'), true) }]),
        basicSetup,
        oneDark,
        languageFor(meta.name),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace", fontSize: '14px' } }),
        yCollab(ytext, awareness, { undoManager }),
      ],
    }),
  });
  view.focus();
  $('#current-file').textContent = meta.name;
  renderFiles();
  renderViewers();
  updateRunButton();
}

// ------------------------------------------------------------------ presence
function viewersByFile() {
  const map = new Map();
  awareness.getStates().forEach((state) => {
    if (!state.user || !state.fileId) return;
    const list = map.get(state.fileId) || [];
    if (!list.some((u) => u.id === state.user.id)) list.push(state.user);
    map.set(state.fileId, list);
  });
  return map;
}

let lastPeople = [];
function renderPeople(users = lastPeople) {
  lastPeople = users;
  const fileOf = new Map();
  awareness.getStates().forEach((s) => {
    if (s.user && s.fileId && filesMap.get(s.fileId)) fileOf.set(s.user.id, filesMap.get(s.fileId).name);
  });
  $('#online-count').textContent = users.length;
  $('#people').replaceChildren(
    ...users.map((u) =>
      el('li', { class: 'person' }, avatar(u, 28), el('div', { class: 'person-info' }, el('span', { class: 'person-name' }, u.username, u.id === me.id ? el('span', { class: 'muted' }, ' (you)') : null), el('span', { class: 'muted small' }, fileOf.has(u.id) ? `editing ${fileOf.get(u.id)}` : 'online')))
    )
  );
  const stack = $('#header-avatars');
  stack.replaceChildren(...users.slice(0, 5).map((u) => avatar(u, 30)));
  if (users.length > 5) stack.append(el('span', { class: 'avatar more' }, `+${users.length - 5}`));
}

function renderViewers() {
  const here = (viewersByFile().get(currentFileId) || []).filter((u) => u.id !== me.id);
  $('#file-viewers').replaceChildren(...here.map((u) => el('span', { class: 'viewer-chip', style: `border-color:${u.color};color:${u.color}` }, u.name)));
}

awareness.on('change', () => {
  renderFiles();
  renderPeople();
  renderViewers();
});

// ------------------------------------------------------------------ right panel tabs
let activePane = 'console';
document.querySelectorAll('.panel-tabs .tab').forEach((t) =>
  t.addEventListener('click', () => showPane(t.dataset.pane))
);
function showPane(name) {
  activePane = name;
  document.querySelectorAll('.panel-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== `pane-${name}`));
  if (name === 'chat') {
    unread = 0;
    updateUnread();
    $('#chat-input').focus();
    scrollChat();
  }
  if (name === 'preview') refreshPreview();
}

// ------------------------------------------------------------------ run code
const output = $('#output');
let running = false;

function appendOutput(text, cls) {
  if (output.dataset.empty !== 'false') {
    output.textContent = '';
    output.dataset.empty = 'false';
  }
  output.append(el('span', { class: cls }, text));
  output.scrollTop = output.scrollHeight;
}

function setRunning(state, by) {
  running = state;
  const btn = $('#run');
  btn.classList.toggle('running', state);
  btn.querySelector('.run-icon').textContent = state ? '■' : '▶';
  btn.querySelector('.run-label').textContent = state ? 'Stop' : 'Run';
  $('#run-status').textContent = state ? `Running… (started by ${by?.username || 'someone'})` : $('#run-status').textContent;
  $('#run-status').className = `run-status small ${state ? 'is-running' : 'muted'}`;
}

function updateRunButton() {
  const meta = currentFileId && filesMap.get(currentFileId);
  const ext = meta ? extOf(meta.name) : '';
  $('#run').title = meta ? (['html', 'htm', 'css'].includes(ext) ? 'Show live preview' : `Run ${meta.name}`) : 'Open a file to run';
}

function runStartedLine(by, file) {
  appendOutput(`▶ ${by.username} ran ${file}\n`, 'out-info');
}

function finishedLine(result) {
  if (output.textContent && !output.textContent.endsWith('\n')) appendOutput('\n');
  if (result.error) appendOutput(`\n✖ ${result.error}\n`, 'out-err');
  const ok = result.code === 0 && !result.error;
  const time = result.durationMs != null ? ` in ${(result.durationMs / 1000).toFixed(2)}s` : '';
  appendOutput(`${ok ? '✔' : '●'} Process exited with code ${result.code}${time}\n\n`, ok ? 'out-ok' : 'out-err');
  $('#run-status').textContent = ok ? `Finished${time}` : `Exited with code ${result.code}`;
}

function runCurrent() {
  if (running) {
    socket.emit('run:stop');
    return;
  }
  const meta = currentFileId && filesMap.get(currentFileId);
  if (!meta) return toast('Open a file first', 'error');
  const ext = extOf(meta.name);
  if (['html', 'htm', 'css'].includes(ext)) return showPane('preview');
  if (!RUNNABLE.includes(ext)) return toast(`Can't run .${ext} files. Runnable: .js .py .c .cpp .java .rb`, 'error');
  showPane('console');
  socket.emit('run:start', { fileId: currentFileId, stdin: $('#stdin').value });
}

$('#run').addEventListener('click', runCurrent);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.defaultPrevented) {
    e.preventDefault();
    runCurrent();
  }
});
$('#clear-output').addEventListener('click', () => {
  output.innerHTML = '';
  output.dataset.empty = 'false';
});
$('#toggle-stdin').addEventListener('click', () => {
  $('#stdin').classList.toggle('hidden');
  $('#toggle-stdin').classList.toggle('active');
  if (!$('#stdin').classList.contains('hidden')) $('#stdin').focus();
});

socket.on('run:started', ({ by, file }) => {
  showPane('console');
  runStartedLine(by, file);
  setRunning(true, by);
});
socket.on('run:output', ({ stream, text }) => appendOutput(text, stream === 'stderr' ? 'out-err' : ''));
socket.on('run:finished', (result) => {
  setRunning(false);
  finishedLine(result);
});
socket.on('run:error', ({ error }) => toast(error, 'error'));

function restoreRun(run) {
  if (!run || joinedOnce) return;
  runStartedLine(run.by, run.file);
  run.output.forEach((o) => appendOutput(o.text, o.stream === 'stderr' ? 'out-err' : ''));
  if (run.running) setRunning(true, run.by);
  else if (run.result) finishedLine(run.result);
}

// ------------------------------------------------------------------ chat
const messagesEl = $('#messages');
let unread = 0;
const seen = new Set();

function updateUnread() {
  const b = $('#unread');
  b.textContent = unread > 9 ? '9+' : unread;
  b.classList.toggle('hidden', unread === 0);
}
function scrollChat() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function messageNode(m) {
  if (m.type === 'system') return el('div', { class: 'msg-system' }, `${m.text} · ${fmtTime(m.at)}`);
  const mine = m.user.id === me.id;
  return el('div', { class: `msg ${mine ? 'mine' : ''}` }, mine ? null : avatar(m.user, 28), el('div', { class: 'msg-body' }, el('div', { class: 'msg-meta' }, el('b', { style: `color:${m.user.color}` }, mine ? 'You' : m.user.username), el('span', { class: 'muted small' }, fmtTime(m.at))), el('div', { class: 'msg-text' }, m.text)));
}
function addMessage(m, countUnread = true) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  messagesEl.append(messageNode(m));
  if (activePane === 'chat') scrollChat();
  else if (countUnread && m.type === 'user' && m.user.id !== me.id) {
    unread++;
    updateUnread();
  }
}
function renderChatHistory(list) {
  if (!messagesEl.childElementCount) messagesEl.append(el('div', { class: 'msg-system' }, `Welcome to ${room.name}! Say hi 👋`));
  list.forEach((m) => addMessage(m, false));
  scrollChat();
}
socket.on('chat:message', (m) => addMessage(m));
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text });
  input.value = '';
});

// ------------------------------------------------------------------ live web preview
function fileContent(name) {
  const f = findByName(name.replace(/^\.\//, ''));
  return f ? ydoc.getText('f:' + f.id).toString() : null;
}

function buildPreview() {
  const current = currentFileId && filesMap.get(currentFileId);
  const entry = current && /\.html?$/i.test(current.name) ? current.name : findByName('index.html')?.name || sortedFiles().find((f) => /\.html?$/i.test(f.name))?.name;
  if (!entry) return `<body style="font-family:system-ui;color:#888;padding:2rem">No HTML file in this room. Create <b>index.html</b> to use the live preview.</body>`;
  let src = fileContent(entry);
  src = src.replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (tag, href) => {
    const c = fileContent(href);
    return c == null ? tag : `<style>\n${c}\n</style>`;
  });
  src = src.replace(/<script\b([^>]*)src=["']([^"']+\.js)["']([^>]*)>\s*<\/script>/gi, (tag, a, href, b) => {
    const c = fileContent(href);
    return c == null ? tag : `<script${a}${b}>\n${c.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });
  return src;
}

let previewTimer;
function refreshPreview() {
  $('#preview').srcdoc = buildPreview();
}
ydoc.on('update', () => {
  if (activePane !== 'preview') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 500);
});
$('#refresh-preview').addEventListener('click', refreshPreview);
$('#open-preview').addEventListener('click', () => {
  const blob = new Blob([buildPreview()], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
});

if (room.language === 'web') {
  // Web rooms start with the preview visible.
  setTimeout(() => showPane('preview'), 300);
}
