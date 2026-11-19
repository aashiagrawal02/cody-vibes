# ✨ Cody Vibes: Real-Time Collaborative Coding Platform

Cody Vibes lets several people write code **together, at the same time**, in the browser. You create a room and share its link. Everyone in the room then sees each other's typing and cursors live, can chat, and can run the code with output shared across the room.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/aashiagrawal02/cody-vibes)

---

## 🌐 Run it online (free, from this GitHub repo)

GitHub Pages can only host static pages, and Cody Vibes needs a live Node.js server, so it is hosted on [Render](https://render.com). Render builds it straight from this repository using the included `Dockerfile` and `render.yaml`.

1. Click **Deploy to Render** above, and sign in to Render with your GitHub account.
2. When asked for **SIGNUP_CODE**, type an invite code of your choice (for example `vibes-2026`). People need it to create an account.
3. Click **Deploy Blueprint** and wait about 5–10 minutes for the first build.
4. Open the link Render shows, such as `https://cody-vibes.onrender.com`.

Every `git push` to `main` redeploys the app automatically.

**Free plan limits:**
- The app **sleeps after 15 minutes** with no visitors. The next visit wakes it in about a minute.
- **Saved data resets** when the app sleeps or redeploys: accounts, rooms and chat start fresh. Download projects you want to keep as ZIP. A paid plan with a persistent disk keeps data permanently.
- All languages work online, including **Java**, which the container installs.

---

## 🚀 Features

| Feature | Details |
|---|---|
| **User accounts** | Sign up / log in. Passwords are hashed with bcrypt and sessions use JWT in an httpOnly cookie |
| **Dashboard** | Create rooms from templates, join a room by code or link, and see who's online. You can also download, delete or leave rooms |
| **Live collaborative editor** | CodeMirror 6 editor with syntax highlighting. Changes sync instantly between users through **Yjs (a CRDT)**, so two people typing at once never conflict |
| **Live cursors & presence** | Each user's cursor and selection shows in their own colour with their name. You can see who is in which file |
| **Multi-file projects** | Create, rename (double-click) and delete files. Imports between files work when running |
| **Run code** | JavaScript (Node), Python 3, C, C++17, Java and Ruby, with **stdin input** and a Stop button. Output streams live to everyone in the room |
| **Live web preview** | HTML/CSS/JS rooms render in a Preview tab that updates as you type |
| **Room chat** | Persistent group chat with unread badges and join/leave messages |
| **Auto-save** | Everything is saved to disk automatically and survives a server restart |
| **Download as ZIP** | Download all files of a room as a `.zip` |
| **Reconnects** | If the connection drops, edits made offline are merged when you reconnect |

---

## 🛠 Tech Stack

- **Backend:** Node.js, Express 5, Socket.IO, Yjs (CRDT document sync), bcryptjs, jsonwebtoken
- **Frontend:** Vanilla JavaScript (ES modules), CodeMirror 6, y-codemirror.next, Socket.IO client, bundled with esbuild
- **Storage:** JSON file database (`data/db.json`) and binary Yjs documents per room (`data/docs/*.bin`). No database server to install.
- **Code execution:** Child processes with time limit, output limit and process-group kill

---

## ▶️ How to Run

**Requirement:** [Node.js](https://nodejs.org) 18 or newer.

```bash
cd "mini project"
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

### Try collaboration on one computer
1. Sign up as one user in a normal browser window and create a room.
2. Click **🔗 Invite** to copy the link.
3. Open a **private/incognito window** (or another browser), sign up as a second user, and paste the link.
4. Type in both windows. You'll see each other's edits and cursors live.

### Collaborate with friends on the same Wi-Fi
Find your computer's local IP (macOS: `ipconfig getifaddr en0`) and have friends open `http://<your-ip>:3000`.

### Share a public link (anyone on the internet)
```bash
npm run share
```
This starts the app and opens a free Cloudflare tunnel. It prints a link like `https://something.trycloudflare.com` and an **invite code**.

**The invite code is optional by default.** Anyone with the link can sign up without it, and invite links fill it in automatically. If someone does type a code, it must be correct. To make the code **required**, so only people you give it to can sign up and run code on your computer, start sharing like this:
```bash
INVITE_REQUIRED=1 npm run share
```

**Inviting friends:** open a room and click **🔗 Invite**. The dialog shows a ready-to-send link with the invite code already inside it, plus buttons to copy it, copy a full invite message, or send it on WhatsApp. Your friend opens the link, picks a username and password (the code is pre-filled), and lands straight in the room. Invite links always use the public address, even if you are using the app at `localhost` yourself. If no public link is running, the dialog warns you that the link only works on your computer.

- The link works only while that command keeps running and your computer stays on and awake. Press Ctrl+C to stop sharing.
- **Each run gives a new random link.** The invite code stays the same (it's saved in `data/invite-code.txt`).
- The tunnel tool lives in `tools/cloudflared/`. On a new machine, download `cloudflared` for your OS from https://github.com/cloudflare/cloudflared/releases and put it there.

### Development mode (auto-rebuild on changes)
```bash
npm run dev
```

### Settings (optional environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `JWT_SECRET` | auto-generated in `data/secret.key` | Secret used to sign login tokens |
| `RUN_TIMEOUT_MS` | `10000` | Max run time of a program |
| `DATA_DIR` | `./data` | Where users, rooms and files are stored |
| `SIGNUP_CODE` | set by `npm run share` | Invite code shown on the sign-up form |
| `INVITE_REQUIRED` | off | Set to `1` to make the invite code mandatory for sign-up |

Code runners only work for languages installed on the machine running the server. At startup the server prints which ones it found (✔ / ✘). JavaScript always works. On this Mac, Python, C, C++ and Ruby were found, but Java needs a JDK installed first (`brew install openjdk`).

---

## 📁 Project Structure

```
mini project/
├── server/
│   ├── index.js       # Express app, REST API, Socket.IO real-time events
│   ├── db.js          # JSON-file database (users, rooms, chat)
│   ├── auth.js        # Password/JWT helpers and auth middleware
│   ├── rooms.js       # Yjs shared documents: load, save, sync, presence
│   ├── runner.js      # Runs code (JS, Python, C, C++, Java, Ruby) safely-ish
│   ├── templates.js   # Starter files for each language
│   └── zip.js         # Tiny ZIP writer for project download
├── client/            # Browser source code (bundled by esbuild)
│   ├── common.js      # Shared helpers (API calls, toasts, avatars)
│   ├── landing.js     # Login / sign-up page
│   ├── dashboard.js   # Room list, create & join
│   └── room.js        # Collaborative editor, files, console, chat, preview
├── public/            # Static files served to the browser
│   ├── index.html, dashboard.html, room.html
│   ├── css/styles.css
│   ├── img/logo.svg
│   └── js/            # Generated bundles (created by `npm run build`)
├── data/              # Created at runtime: database, room documents, secret
├── build.js           # esbuild bundling script
└── package.json
```

---

## 🧠 How Real-Time Sync Works

1. Each room is a **Yjs document**. It holds a map of files, and each file's text is a `Y.Text`.
2. When you type, the editor binding turns your change into a small binary **update**, which the browser sends to the server over Socket.IO.
3. The server applies the update to its copy of the document, saves it to disk (debounced), and forwards it to everyone else in the room.
4. Yjs is a **CRDT**: updates can arrive in any order, even after being offline, and every copy still ends up with exactly the same text, with no lost keystrokes.
5. Cursor positions, names and the open file are shared through the Yjs **awareness** protocol, which is not saved.

```
 Browser A ──update──▶ Server (Y.Doc + save to disk) ──update──▶ Browser B
     ▲                                                           │
     └──────────────────────────update───────────────────────────┘
```

---

## 🔌 API Overview

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Current user |
| GET | `/api/rooms` | Rooms you're a member of |
| POST | `/api/rooms` | Create room `{ name, language }` |
| GET | `/api/rooms/:id` | Room info (also joins it) |
| PATCH | `/api/rooms/:id` | Rename (owner only) |
| DELETE | `/api/rooms/:id` | Delete (owner) / leave (member) |
| GET | `/api/rooms/:id/download` | Download project as ZIP |
| GET | `/api/runtimes` | Which languages can run on this server |

**Socket.IO events:** `room:join`, `sync:update`, `awareness:update`, `chat:send` / `chat:message`, `run:start` / `run:output` / `run:finished` / `run:stop`, `presence`.

---

## ⚠️ Security Note

Running code executes real programs **on the computer hosting the server**, with a time limit and an output limit. That's fine for a local or classroom project with people you trust. Before putting it on the public internet, run code inside Docker containers or a sandbox service.

---

## 💡 Possible Future Improvements
- Docker-based sandbox for code execution
- Voice/video calls inside rooms
- Room roles (read-only viewers)
- Folders in the file tree
- Version history using Yjs snapshots
