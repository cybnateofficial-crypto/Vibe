# 🚀 Going live — everything from your phone

You need: a phone, your GitHub repo, and a free Render account. Total time ≈ 30–45 minutes the first time.

---

## Step 0 — get the code into your GitHub repo

Pick whichever works on your phone:

### Option A — ask me to push (easiest, needs one-time setup)
1. On github.com (mobile browser is fine): **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Repository access: **Only select repositories → your vibeforge repo**
3. Permissions: **Contents → Read and write** (nothing else)
4. Expiration: **7 days**
5. Paste the token in the chat with your repo name (e.g. `https://github.com/you/vibeforge`), tell me to push, then **revoke the token immediately after** (Settings → same page → Revoke).
   > The token only ever lets someone touch that one repo, and it dies when you revoke it.

### Option B — do it yourself with Termux (fully private, no token sharing)
1. Install **Termux** from F-Droid (Play version is outdated): f-droid.org → search Termux
2. In Termux, paste these lines one by one:
```bash
pkg update -y && pkg install -y git unzip
termux-setup-storage      # tap "Allow"
git clone https://github.com/YOU/YOUR-REPO.git repo
cd repo && git config user.email "you@example.com" && git config user.name "you"
```
3. Download `vibeforge.zip` from this chat to your phone, then:
```bash
cd ~/repo
unzip -o ~/storage/downloads/vibeforge.zip -d /tmp/vf
cp -r /tmp/vf/vibeforge/* .
git add -A && git commit -m "VibeForge v2" && git push
```
GitHub will ask for a password → paste the fine-grained token from Option A step 1 (Contents: Read and write).

### Option C — Chrome "Desktop site" upload
Chrome menu → **Desktop site**, open your repo → **Add file → Upload files** → select everything from the unzipped folder. Works for small batches; folders are fiddly on mobile.

---

## Step 1 — put the server online (Render, free)

1. Go to **render.com** → Sign up with GitHub (free).
2. **New → Web Service** → pick your repo.
3. Settings:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node src/index.js`
   - **Instance type:** Free
4. Click **Create Web Service**. First deploy takes ~2 minutes.
5. When it's live, copy your URL (looks like `https://vibeforge-server.onrender.com`).

> Free tier sleeps after 15 minutes idle — the first request then takes ~30–60 seconds to wake.
> That's fine while testing with friends; upgrade to the $7 Starter plan (always-on) when you have paying users. Render → your service → Settings → Instance Type.

## Step 2 — add your secret keys (Render → your service → Environment)

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com (add ~$5 credit) |
| `ADMIN_TOKEN` | make up a long random string — this protects your /admin page |
| `APP_SECRET` | any long random string (encrypts passwords/keys at rest) |
| `SERVER_URL` | your Render URL, e.g. `https://vibeforge-server.onrender.com` |
| `MODEL_FREE` | `anthropic:claude-haiku-4-5` |
| `MODEL_STARTER` | `anthropic:claude-haiku-4-5` |
| `MODEL_PRO` | `anthropic:claude-sonnet-5` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | from Razorpay (start with **test mode** keys) |
| `RAZORPAY_WEBHOOK_SECRET` | make up a secret; paste the same into Razorpay's webhook page |

Save → Render redeploys automatically. (You can also paste all of this into a `server/.env` file — same names.)

Want the free tier to cost you almost nothing? Use OpenRouter for `MODEL_FREE`, e.g.
`MODEL_FREE=openrouter:deepseek/deepseek-chat` + `OPENROUTER_API_KEY=...`. Cheapest quality/cost combo.

## Step 3 — connect Razorpay

1. Sign up at **razorpay.com** (Individual account is fine: PAN + bank account, approval usually 1–2 days).
2. Dashboard → **Account & Settings → API Keys → Generate** (test mode first!). Copy into Render env vars.
3. Dashboard → **Webhooks → Add**:
   - URL: `https://YOUR-APP.onrender.com/api/billing/webhook`
   - Events: **payment_link.paid** and **payment.captured**
   - Secret: the same string you put in `RAZORPAY_WEBHOOK_SECRET`
4. Test the whole flow with a test card (Razorpay gives test cards in its docs) → your account should flip to "starter" in the app within seconds.
5. When you're happy: generate **live** keys, swap them in Render, and you're accepting UPI/cards for real money.

Until Razorpay approves you, use **activation codes**: open `https://YOUR-APP.onrender.com/admin?token=YOUR_ADMIN_TOKEN` → "Make activation codes" → send a code to a user → they redeem it in Settings → Account. You can even sell codes manually over UPI.

## Step 4 — build the APK (free, in GitHub's cloud)

1. In your repo: **Actions tab → "Build Android APK" → Run workflow**.
2. Wait ~10–15 minutes (first run is slowest).
3. Open the finished run → **Artifacts → vibeforge-apk** → download the zip → unzip → install `app-debug.apk` on your phone (allow "install unknown apps").

Do this again after every code change — the workflow also runs automatically on every push that touches `app/`.

## Step 5 — first run & checklist

1. Open the app → enter your Render URL → **Test connection** → sign up with your email.
2. Build something to check the AI works.
3. Open `/admin?token=...` from your phone browser: you should see yourself as a user, with usage counted.
4. Create an activation code for yourself, redeem it, confirm the plan badge changes.
5. (Razorpay live) buy your own Starter plan with a real ₹1 test payment — I won't judge.

## Troubleshooting

| Problem | Fix |
|---|---|
| First request takes ~60s | Render free tier waking up. Normal. |
| "AI: demo mode" on the health page | API key missing/wrong in Render env vars → save → redeploy. |
| Payment done but plan not active | Open the app → Settings → tap "I have paid — check now". If still stuck, check the webhook URL/secret in Razorpay. |
| Razorpay says "Authentication failed" | You mixed test and live keys. Test keys start with `rzp_test_`. |
| Build fails in Actions | Open the failed step log; usually a transient Gradle download — re-run the workflow. |
| Users complain about 30s waits | Time to move to the $7 always-on plan. |
| You want to see costs | `/admin?token=...` shows estimated AI cost per user. |

## Costs cheat-sheet

| Item | Cost |
|---|---|
| Render free server | ₹0 (sleeps) — fine for testing |
| Render Starter (always-on) | ~$7/mo ≈ ₹600 |
| Anthropic keys | pay per use (~₹2–18 per app generation depending on model) |
| Razorpay | ~2% per transaction, no monthly fee |
| GitHub Actions | ₹0 (free minutes cover it) |
| Google Play account (later, optional) | $25 one-time |

**Your margin:** Starter ₹299/mo − ~₹100–150 API+hosting − ₹6 payment fee ≈ **₹150+ profit per user per month**, and it grows with every plan tier and yearly purchase. 100 paying users ≈ ₹15,000–45,000/month of margin depending on mix.
