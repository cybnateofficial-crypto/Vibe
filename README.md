# ⚡ VibeForge — your own AI app builder (Android + server)

> **v2 (SaaS mode):** multi-user accounts, subscription plans with different AI models per plan
> (Free / Starter ₹299 / Pro ₹799), Razorpay payments, activation codes, owner admin dashboard,
> and BYOK (users can bring their own API key). **To launch: follow [DEPLOY.md](DEPLOY.md)** —
> everything can be done from your phone.

VibeForge is a mini **Lovable + Replit for your phone**: you describe an app in plain words,
an AI agent writes the code on your computer, and the live preview appears instantly on your
phone. Code editor, files, and chat — all in one Android app.

Built and tested for you: the server was verified end-to-end (project → AI writes files →
preview serves), and the app's TypeScript compiles clean with zero errors.

---

## 1) What's in this folder

```
vibeforge/
├── server/                 ← the brain (Node.js, ZERO dependencies)
│   ├── src/
│   │   ├── index.js        HTTP API + preview hosting
│   │   ├── agent.js        the agent loop (prompt → tools → files → repeat)
│   │   ├── providers.js    AI drivers: Claude / OpenAI / Gemini / demo mode
│   │   ├── tools.js        write_file, read_file, list_files, delete_file, finish
│   │   ├── workspace.js    projects stored as real folders on your disk
│   │   ├── jobs.js         background jobs the app polls
│   │   ├── skills.js       keyword playbooks injected into the prompt
│   │   └── static.js       serves your generated apps as live previews
│   ├── skills/             playbooks (todo-app.md, landing-page.md) — add your own!
│   ├── .env.example        ← copy to .env and add your AI key here
│   ├── workspaces/         generated apps live here (created at runtime)
│   └── data/projects.json  chat history + project list
│
└── app/                    ← the Android app (Expo / React Native)
    ├── App.tsx             4 tabs: Chat · Preview · Code · Settings
    ├── src/screens/        ChatScreen, PreviewScreen, CodeScreen, SettingsScreen
    ├── src/api.ts          typed client for the server
    ├── android/            ← ALREADY GENERATED: open this folder in Android Studio
    └── eas.json            config for building an APK in the cloud (free)
```

**How it works**

```
📱 Your phone (VibeForge app)
     │  HTTP (same Wi-Fi / LAN)
     ▼
💻 Your computer (server on port 8787)
     ├── agent loop  ──HTTPS──▶  AI provider (Claude / OpenAI / Gemini …)
     ├── writes files            → server/workspaces/<project>/
     └── hosts live previews     → http://<your-ip>:8787/preview/<project>/
                                     (shown in the app's Preview tab WebView)
```

---

## 2) Run it in 5 minutes

### Step A — start the server (on your computer)

1. Install **Node.js 18+** if you don't have it: <https://nodejs.org> (LTS button).
2. Open a terminal in the `server` folder:

```bash
cd vibeforge/server
npm start
```

You'll see:

```
⚡ VibeForge server is live
Provider : mock (demo-mode)     ← until you add an AI key (Step C)
Local    : http://localhost:8787
Phone    : http://<your-computer-LAN-IP>:8787
```

### Step B — run the app on your phone (pick ONE way)

**Way 1 — Expo Go (fastest, zero setup, recommended to start)**

1. Install **Expo Go** from the Play Store on your phone.
2. On your computer:

```bash
cd vibeforge/app
npm install          # only the first time (downloads Expo + React Native)
npx expo start
```

3. A QR code appears in the terminal. Open **Expo Go → Scan QR code** and scan it.
   VibeForge opens on your phone. (Phone and computer must be on the **same Wi-Fi**.)

**Way 2 — Android Studio (your preferred path — the native project is already generated)**

1. Open the folder **`vibeforge/app/android`** in Android Studio
   (File → Open → select the `android` folder, not `app`).
2. Let Gradle sync (first time downloads the Android build tools — a few minutes).
3. Connect your phone via USB with **USB debugging** on, or start an emulator.
4. Press the green ▶ **Run** button. VibeForge installs and opens.

> Note: Android Studio builds need **JDK 17** (Android Studio bundles its own — it just works).
> Everything network-related is already configured (`usesCleartextTraffic="true"`), so the
> http:// LAN preview just works.

**Way 3 — build an installable APK in the cloud (free, no Android Studio needed)**

```bash
cd vibeforge/app
npm install -g eas-cli        # once
eas login                     # create a free account at expo.dev
eas build -p android --profile preview
```

When it finishes (~10 min), you get a **download link for an .apk** — open it on your phone
and install (allow "install from unknown sources"). Send the link to anyone.

### Step C — connect the app to your server

1. Find your computer's IP:
   - **Windows:** `ipconfig` → look for `IPv4 Address` (e.g. `192.168.1.5`)
   - **Mac/Linux:** `ifconfig` or `ip addr`
2. In the app: **Settings tab → paste `http://<that-IP>:8787` → Save & test connection.**
3. Go to the **Chat tab**, type *"build a todo app with dark mode"* and watch it build —
   the Preview tab shows the app the moment it's ready.

On Windows, when the firewall popup appears the first time you run `npm start`, click **Allow**.

---

## 3) Give it a real brain (the "you, not Gemini" part)

Out of the box the server runs in **demo mode** — a built-in mock that produces a real working
todo app so you can feel the entire flow with zero setup. It's clearly labeled and only meant
for trying things out.

You cannot literally embed *this chat* in an app, but the right equivalent is a **Claude-class
model** as the engine — Claude is the family behind agents like me, and it's the strongest at
code. Here's how to switch:

1. Go to <https://console.anthropic.com> → create an account → **Billing → add ~$5 credit**
   (Claude API is pay-per-use; a typical app generation costs a few cents).
2. **API Keys → Create key** → copy it.
3. In `vibeforge/server/`, copy `.env.example` to `.env` and paste:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
```

4. Restart the server (Ctrl+C, then `npm start`). The banner should now say
   `Provider : anthropic (claude-sonnet-5)`.

**Other options** (same `.env` file, one line switches everything):

| You want | Set this | Notes |
|---|---|---|
| Claude (recommended) | `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | best code quality; pay-per-use |
| ChatGPT / any OpenAI-compatible | `AI_PROVIDER=openai` + `OPENAI_API_KEY` | also works with **OpenRouter / Groq** — just change `OPENAI_BASE_URL` and `OPENAI_MODEL` |
| Gemini | `AI_PROVIDER=gemini` + `GEMINI_API_KEY` | you already found the output weak — kept as an option |
| No key / testing | `AI_PROVIDER=mock` or leave everything empty | demo mode |

> 🔒 Your API key lives only in `server/.env` on your computer. It is never sent to the phone.
> Never paste keys into chat apps or commit `.env` to GitHub (already in `.gitignore`).

---

## 4) Things you can say to it

- *"Build a habit tracker with streaks and a calendar view"*
- *"Make the header sticky and switch the accent to teal"*
- *"Add a dark/light toggle that remembers the choice"*
- *"This list looks cramped — improve the spacing and typography"*

Useful: the agent keeps the conversation context, preserves your existing features when
editing, and follows `server/skills/*.md` playbooks when your request matches their keywords.
**Add your own playbook** — drop a markdown file in `server/skills/` with `keywords:` in the
frontmatter, restart the server, and the agent will follow your house style.

---

## 5) API reference (useful when you build the web version later)

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | server + provider status |
| GET/POST | `/api/projects` | list / create projects |
| GET/DELETE | `/api/projects/:id` | project detail (messages + files) / delete |
| GET | `/api/projects/:id/file?path=` | read one file |
| POST | `/api/projects/:id/chat` | `{prompt}` → starts a job, returns `{jobId}` |
| GET | `/api/jobs/:id` | job status + live event stream (poll this) |
| GET | `/preview/:id/*` | the generated app itself (this is what the WebView shows) |

Everything is plain JSON over HTTP with CORS enabled — a web frontend can reuse this server
as-is.

---

## 6) Troubleshooting

| Problem | Fix |
|---|---|
| App says "Timed out / not connected" | ① Server running? ② Same Wi-Fi on both? ③ Right IP in Settings? ④ Windows firewall → Allow Node.js. |
| Works on `localhost` but not from phone | You're probably using `localhost` in the app. Use the LAN IP (`192.168.x.x`), not `127.0.0.1`. |
| IP keeps changing | Set a static/reserved IP on your router, or just re-check with `ipconfig`. |
| Preview is blank | The project has no files yet — build something in Chat first, then hit ⟳ in Preview. |
| `401` / "API key invalid" | Typo in `.env`, or you edited `.env` but didn't restart the server. |
| Port 8787 already in use | Change `PORT=8788` in `.env`, restart, and update the URL in the app Settings. |
| Expo Go says "SDK mismatch" | Update Expo Go from the Play Store. |
| Android Studio: "SDK location not found" | Let Studio install the SDK when prompted; accept licenses. |

---

## 7) Where to take it next (roadmap ideas)

1. **Streaming tokens** — move from polling to SSE so text appears word-by-word.
2. **Undo / checkpoints** — `git init` inside each project; commit every turn, show a history slider.
3. **Annotation mode** — tap a spot in the preview and say "make this blue" (Lovable's killer feature).
4. **Real sandboxes** — E2B or Daytona microVMs for running arbitrary user code safely (v1 keeps everything static files + LAN-only for good reasons).
5. **Publish button** — one-tap deploy of a user's generated app (Vercel/Cloudflare/Netlify API).
6. **Templates gallery** — starter projects users can remix (like AI Studio's gallery).
7. **Accounts + billing** — auth, quotas, Stripe; then EAS-build the app for the Play Store.
8. **Web version** — the exact same server powers a Next.js web UI; that's the Replit/Lovable experience for desktop users.

> Note on **morluto/rea** (the repo you shared): it's an *MCP reverse-engineering toolkit for
> agents* — useful if you later want your platform to inspect/analyze binaries or app behavior
> (`npx rea-agents setup`). It's not part of your product's stack, so v1 doesn't need it.

---

## 8) Safety notes (read once)

- This server is designed for **your own LAN**. Don't port-forward it to the public internet
  until you add auth and real sandboxing — generated code is served as static files, and a
  public deployment would need isolation (see roadmap #4).
- Generated apps run inside the phone's WebView with JS enabled — fine for v1, revisited when
  you open the platform to other users.
- Back up `server/data/` and `server/workspaces/` if you care about your projects — they're
  plain folders, easy to copy.

Built by you + Arena Agent Mode. Hack away. ⚡
