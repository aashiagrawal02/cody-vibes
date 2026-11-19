// Shared helpers for all pages.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function currentUser() {
  try {
    return (await api('/api/auth/me')).user;
  } catch {
    return null;
  }
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

export function avatar(user, size = 30) {
  const a = el('span', { class: 'avatar', title: user.username, style: `background:${user.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px` }, (user.username[0] || '?').toUpperCase());
  return a;
}

let toastTimer;
export function toast(message, type = 'info') {
  let t = $('#toast');
  if (!t) {
    t = el('div', { id: 'toast' });
    document.body.append(t);
  }
  t.textContent = message;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export const LANG_ICONS = { javascript: 'JS', python: 'PY', cpp: 'C++', c: 'C', java: 'JV', ruby: 'RB', web: 'WEB' };

// ------------------------------------------------------------------ invites
let configPromise;
export function getConfig() {
  if (!configPromise) configPromise = api('/api/config').catch(() => ({}));
  return configPromise;
}

export const isLocalOrigin = (origin = location.origin) => /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(origin);

/** The link friends should open. Prefers the public tunnel URL over localhost and includes the invite code. */
export function buildInviteLink(roomId, cfg = {}) {
  const base = isLocalOrigin() && cfg.publicUrl ? cfg.publicUrl : location.origin;
  const url = new URL(`/room/${encodeURIComponent(roomId)}`, base);
  if (cfg.inviteCode) url.searchParams.set('invite', cfg.inviteCode);
  return url.toString();
}

export async function openInviteModal(room) {
  const cfg = await getConfig();
  const link = buildInviteLink(room.id, cfg);
  const localOnly = isLocalOrigin(new URL(link).origin);
  const message = `Join my Cody Vibes coding room "${room.name}" 👩‍💻👨‍💻\n${link}${cfg.inviteRequired && cfg.inviteCode ? `\n(Invite code: ${cfg.inviteCode})` : ''}`;

  document.querySelector('.modal-backdrop')?.remove();
  const close = () => backdrop.remove();
  const linkInput = el('input', { class: 'invite-link', value: link, readonly: true, onclick: (e) => e.target.select() });
  const copyBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Copy link');
  copyBtn.addEventListener('click', async () => {
    await copyText(link);
    copyBtn.textContent = 'Copied ✓';
    setTimeout(() => (copyBtn.textContent = 'Copy link'), 1800);
  });

  const backdrop = el(
    'div',
    { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && close() },
    el(
      'div',
      { class: 'modal card', role: 'dialog', 'aria-label': 'Invite friends' },
      el('div', { class: 'modal-head' }, el('h2', {}, '🔗 Invite friends'), el('button', { class: 'icon-btn', title: 'Close', onclick: close }, '✕')),
      el('p', { class: 'muted small' }, `Send this link to your friends. They open it, create an account (or log in), and land straight in "${room.name}".`),
      localOnly
        ? el(
            'div',
            { class: 'invite-warning' },
            el('b', {}, '⚠️ This link only works on your own computer.'),
            el('span', {}, ' To invite friends on other devices, stop the server and run '),
            el('code', {}, 'npm run share'),
            el('span', {}, ' in the project folder. Then open the public https link it prints, and invite from there.')
          )
        : null,
      el('div', { class: 'invite-row' }, linkInput, copyBtn),
      cfg.inviteRequired && cfg.inviteCode ? el('p', { class: 'small muted' }, 'Invite code ', el('code', {}, cfg.inviteCode), ' is already inside the link. Friends only need to type it if they open the site without the link.') : null,
      el(
        'div',
        { class: 'invite-actions' },
        el('button', { class: 'btn btn-ghost small', type: 'button', onclick: async () => { await copyText(message); toast('Invite message copied, paste it in any chat!'); } }, '📋 Copy invite message'),
        el('a', { class: 'btn btn-ghost small', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, '💬 WhatsApp'),
        navigator.share ? el('button', { class: 'btn btn-ghost small', type: 'button', onclick: () => navigator.share({ title: 'Cody Vibes', text: message }).catch(() => {}) }, '📤 Share…') : null
      ),
      el('p', { class: 'small muted' }, 'Room code: ', el('code', {}, room.id), ' (friends can also paste it into "Join a room" on their dashboard).')
    )
  );
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.append(backdrop);
  linkInput.select();
}
