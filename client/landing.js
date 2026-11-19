import { api, currentUser, $ } from './common.js';

const params = new URLSearchParams(location.search);
const next = params.get('next') && params.get('next').startsWith('/') ? params.get('next') : '/dashboard';

let mode = 'login';
let inviteEnabled = false;
let inviteRequired = false;
api('/api/config').then((c) => {
  inviteEnabled = c.inviteEnabled;
  inviteRequired = c.inviteRequired;
  setMode(mode);
}).catch(() => {});
const form = $('#auth-form');
const errorEl = $('#auth-error');
const submit = $('#auth-submit');

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  submit.textContent = m === 'login' ? 'Log in' : 'Create account';
  form.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('#auth-hint').innerHTML =
    m === 'login'
      ? 'New here? <a href="#" data-switch="signup">Create an account</a>'
      : 'Already have an account? <a href="#" data-switch="login">Log in</a>';
  errorEl.textContent = '';
  const showInvite = inviteEnabled && m === 'signup';
  $('#invite-label').classList.toggle('hidden', !showInvite);
  $('#invite-label-text').textContent = inviteRequired ? 'Invite code' : 'Invite code (optional)';
  form.inviteCode.placeholder = inviteRequired ? 'Ask whoever shared this link' : 'Leave empty if you don’t have one';
  form.inviteCode.required = showInvite && inviteRequired;
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
document.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-switch]');
  if (sw) {
    e.preventDefault();
    setMode(sw.dataset.switch);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  submit.disabled = true;
  try {
    await api(`/api/auth/${mode}`, { method: 'POST', body: { username: form.username.value.trim(), password: form.password.value, inviteCode: form.inviteCode.value.trim() } });
    location.href = next;
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

// Opened from an invite link: pre-fill the code and say what's happening.
const invite = params.get('invite');
if (invite) form.inviteCode.value = invite;
if (params.get('next')?.startsWith('/room/')) {
  $('#invite-banner').classList.remove('hidden');
  $('#invite-banner').textContent = invite
    ? "🎉 You've been invited to a coding room! Create an account (the invite code is already filled in for you) or log in, and you'll go straight into the room."
    : "🎉 You've been invited to a coding room! Create an account or log in, and you'll go straight into the room.";
}
if (params.get('next')) setMode('signup');

currentUser().then((u) => {
  if (u) location.href = next;
});
