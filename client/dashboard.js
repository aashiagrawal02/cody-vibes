import { api, currentUser, logout, $, el, avatar, toast, timeAgo, LANG_ICONS, openInviteModal } from './common.js';

const me = await currentUser();
if (!me) location.href = '/?next=/dashboard';

$('#me').append(avatar(me, 30), el('span', {}, me.username));
$('#hello-name').textContent = me.username;
$('#logout').addEventListener('click', logout);

// Templates
const templates = await api('/api/templates');
$('#language').append(...templates.map((t) => el('option', { value: t.id }, t.label)));

$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const room = await api('/api/rooms', { method: 'POST', body: { name: f.name.value, language: f.language.value } });
    location.href = `/room/${room.id}`;
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = e.target.code.value.trim();
  const match = raw.match(/([a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3})/i);
  const code = match ? match[1].toLowerCase() : raw;
  try {
    await api(`/api/rooms/${encodeURIComponent(code)}`);
    location.href = `/room/${code}`;
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function loadRooms() {
  const list = $('#rooms');
  let rooms;
  try {
    rooms = await api('/api/rooms');
  } catch (err) {
    list.replaceChildren(el('p', { class: 'muted' }, err.message));
    return;
  }
  if (!rooms.length) {
    list.replaceChildren(el('div', { class: 'empty card' }, el('div', { class: 'empty-emoji' }, '🎧'), el('p', {}, 'No rooms yet. Create one above and invite your friends!')));
    return;
  }
  list.replaceChildren(
    ...rooms.map((r) => {
      return el(
        'div',
        { class: 'room-card card' },
        el('div', { class: 'room-card-top' }, el('span', { class: `lang-badge lang-${r.language}` }, LANG_ICONS[r.language] || '{}'), el('div', { class: 'room-card-title' }, el('h3', {}, r.name), el('span', { class: 'muted small' }, `${r.languageLabel} · ${r.id}`))),
        el(
          'div',
          { class: 'room-card-meta small muted' },
          el('span', {}, r.isOwner ? '👑 You own this' : `by ${r.owner?.username || 'unknown'}`),
          el('span', {}, `👥 ${r.memberCount} member${r.memberCount === 1 ? '' : 's'}`),
          el('span', {}, `🕒 ${timeAgo(r.lastActive)}`)
        ),
        el('div', { class: 'room-card-online' }, r.online.length ? [el('span', { class: 'live-dot' }), ...r.online.map((u) => avatar(u, 24)), el('span', { class: 'small muted' }, `${r.online.length} coding now`)] : el('span', { class: 'small muted' }, 'Nobody online')),
        el(
          'div',
          { class: 'room-card-actions' },
          el('a', { class: 'btn btn-primary small', href: `/room/${r.id}` }, 'Open'),
          el('button', { class: 'btn btn-ghost small', onclick: () => openInviteModal(r) }, '🔗 Invite'),
          el('a', { class: 'btn btn-ghost small', href: `/api/rooms/${r.id}/download` }, 'Download'),
          el(
            'button',
            {
              class: 'btn btn-danger small',
              onclick: async () => {
                const msg = r.isOwner ? `Delete "${r.name}" for everyone? This cannot be undone.` : `Leave "${r.name}"?`;
                if (!confirm(msg)) return;
                try {
                  await api(`/api/rooms/${r.id}`, { method: 'DELETE' });
                  toast(r.isOwner ? 'Room deleted' : 'Left room');
                  loadRooms();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            r.isOwner ? 'Delete' : 'Leave'
          )
        )
      );
    })
  );
}

$('#refresh').addEventListener('click', loadRooms);
loadRooms();
setInterval(loadRooms, 15000);
