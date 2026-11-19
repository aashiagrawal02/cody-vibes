const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

const COOKIE = 'cv_token';
const SECRET_FILE = path.join(db.DATA_DIR, 'secret.key');

// Use JWT_SECRET env var, or generate one once and keep it on disk.
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  else {
    SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
  }
}

const COLORS = ['#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#fb923c', '#f87171', '#22d3ee', '#c084fc', '#4ade80'];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

function signToken(user) {
  return jwt.sign({ sub: user.id }, SECRET, { expiresIn: '30d' });
}

function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    return db.findUserById(payload.sub);
  } catch {
    return null;
  }
}

function publicUser(u) {
  return u ? { id: u.id, username: u.username, color: u.color } : null;
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// Express middleware
function requireAuth(req, res, next) {
  const user = userFromToken(req.cookies?.[COOKIE]);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

module.exports = { COOKIE, randomColor, signToken, userFromToken, publicUser, setAuthCookie, parseCookies, requireAuth };
