// VibeForge server v2 — multi-user SaaS mode. Zero dependencies.
// Accounts + plans + quotas + Razorpay billing + admin dashboard + preview hosting.
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { DB, signToken, verifyToken, encrypt, decrypt, verifyPassword } from './db.js';
import { Workspace } from './workspace.js';
import { Jobs } from './jobs.js';
import { MockProvider } from './providers.js';
import { resolveModelSpec, providerFromByok, friendlyName } from './models.js';
import { runAgent } from './agent.js';
import { serveStatic } from './static.js';
import { PLANS, getPlan, effectivePlanId, usageState, modelSpecForTier, estimateCostUsd } from './plans.js';
import { billingConfigured, createPaymentLink, verifyWebhookSignature, activatePlan, successPageHtml } from './billing.js';
import { adminPage } from './admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
loadEnv(path.join(serverRoot, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:' + PORT).replace(/\/+$/, '');
const ADMIN_TOKEN =
  (process.env.ADMIN_TOKEN || '').trim() || crypto.randomBytes(8).toString('hex');

const ws = new Workspace(path.join(serverRoot, 'workspaces'), path.join(serverRoot, 'data'));
const db = new DB(path.join(serverRoot, 'data'));
const jobs = new Jobs();

const aiConfigured = !!(
  (process.env.ANTHROPIC_API_KEY || '').trim() ||
  (process.env.OPENAI_API_KEY || '').trim() ||
  (process.env.OPENROUTER_API_KEY || '').trim() ||
  (process.env.GEMINI_API_KEY || '').trim()
);

// ── helpers ──
const json = (res, code, obj) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(obj));
};

function readBodyRaw(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readBody(req) {
  const raw = await readBodyRaw(req);
  try {
    return { data: raw ? JSON.parse(raw) : {}, raw };
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function currentUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const uid = verifyToken(db.secret, token);
  return uid ? db.findUserById(uid) : null;
}

function adminOk(req, url) {
  const t = req.headers['x-admin-token'] || url.searchParams.get('token') || '';
  return String(t) === ADMIN_TOKEN;
}

function publicUser(u) {
  const us = usageState(u);
  return {
    id: u.id,
    email: u.email,
    plan: effectivePlanId(u),
    planExpiresAt: u.planExpiresAt,
    byok: u.byok ? { provider: u.byok.provider, model: u.byok.model || null } : null,
    usage: { used: us.used, limit: us.limit, remaining: us.remaining, period: us.plan.period },
    createdAt: u.createdAt,
  };
}

function plansPublic() {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    monthly: p.monthly,
    yearly: p.yearly,
    genLimit: p.genLimit,
    period: p.period,
    tagline: p.tagline,
    model: friendlyName(modelSpecForTier(p.tier) || ''),
  }));
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
}

const LANDING = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VibeForge server</title><style>
body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0d12;color:#eaeef7;display:grid;place-items:center;min-height:100vh}
.card{max-width:600px;padding:36px;border:1px solid #242c3f;border-radius:20px;background:#12161f}
h1{margin:0 0 6px;font-size:26px}.sub{color:#8b93a7;margin:0 0 20px;font-size:14px}
.pill{display:inline-block;padding:6px 12px;border-radius:999px;background:#1d1740;color:#b7a6ff;font-size:13px;margin:0 8px 8px 0}
code{background:#1b2233;padding:2px 8px;border-radius:8px;font-size:13px}
a{color:#b7a6ff}p{color:#c6cddd;font-size:14px;line-height:1.6}
</style></head><body><div class="card">
<h1>⚡ VibeForge server <span style="font-size:14px;color:#8b93a7">v2 · SaaS mode</span></h1>
<p class="sub">Powers the VibeForge app: accounts, AI agent, quotas, subscriptions, live previews.</p>
<div><span class="pill">AI: AI_STATUS</span><span class="pill">payments: PAY_STATUS</span><span class="pill">users: USER_COUNT</span></div>
<p>API health: <a href="/health">/health</a> · plans: <a href="/api/plans">/api/plans</a> · owner dashboard: <a href="/admin">/admin</a></p>
<p style="color:#8b93a7;font-size:13px">Project previews live at <code>/preview/&lt;project-id&gt;/</code></p>
</div></body></html>`;

// ── server ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-admin-token',
    });
    return res.end();
  }

  try {
    // ── public: landing + health ──
    if (req.method === 'GET' && p === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(
        LANDING.replace('AI_STATUS', aiConfigured ? 'configured' : 'demo mode')
          .replace('PAY_STATUS', billingConfigured() ? 'configured' : 'not yet')
          .replace('USER_COUNT', String(db.data.users.length))
      );
    }

    if (req.method === 'GET' && p === '/health') {
      return json(res, 200, {
        ok: true,
        server: 'vibeforge',
        version: 2,
        aiConfigured,
        billingConfigured: billingConfigured(),
        users: db.data.users.length,
        projects: ws.list(null).length,
        time: Date.now(),
      });
    }

    if (req.method === 'GET' && p === '/api/plans') {
      return json(res, 200, { plans: plansPublic() });
    }

    // ── auth ──
    if (req.method === 'POST' && p === '/api/auth/signup') {
      const { data } = await readBody(req);
      const email = String(data.email || '');
      const password = String(data.password || '');
      if (!validEmail(email)) return json(res, 400, { error: 'Please enter a valid email address.' });
      if (password.length < 6)
        return json(res, 400, { error: 'Password must be at least 6 characters.' });
      if (db.findUserByEmail(email))
        return json(res, 400, { error: 'An account with this email already exists. Try logging in.' });
      const user = db.createUser(email, password);
      const token = signToken(db.secret, user.id);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (req.method === 'POST' && p === '/api/auth/login') {
      const { data } = await readBody(req);
      const user = db.findUserByEmail(String(data.email || ''));
      if (!user || !verifyPassword(String(data.password || ''), user.salt, user.hash))
        return json(res, 401, { error: 'Wrong email or password.' });
      const token = signToken(db.secret, user.id);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (req.method === 'GET' && p === '/api/auth/me') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      return json(res, 200, { user: publicUser(user), plans: plansPublic() });
    }

    if (req.method === 'POST' && p === '/api/auth/byok') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const { data } = await readBody(req);
      const provider = String(data.provider || '').toLowerCase();
      const key = String(data.key || '').trim();
      if (!['anthropic', 'openai', 'openrouter', 'gemini'].includes(provider))
        return json(res, 400, { error: 'provider must be one of: anthropic, openai, openrouter, gemini' });
      if (key.length < 12) return json(res, 400, { error: 'That key looks too short.' });
      user.byok = {
        provider,
        keyEnc: encrypt(db.secret, key),
        model: data.model ? String(data.model) : null,
        addedAt: Date.now(),
      };
      db.save();
      return json(res, 200, { ok: true, byok: { provider, model: user.byok.model } });
    }

    if (req.method === 'DELETE' && p === '/api/auth/byok') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      user.byok = null;
      db.save();
      return json(res, 200, { ok: true });
    }

    // ── billing ──
    if (req.method === 'POST' && p === '/api/billing/checkout') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const { data } = await readBody(req);
      const period = data.period === 'year' ? 'year' : 'month';
      const link = await createPaymentLink({ user, planId: String(data.planId || ''), period });
      return json(res, 200, link);
    }

    if (req.method === 'POST' && p === '/api/billing/verify') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const { data } = await readBody(req);
      const linkId = String(data.linkId || '');
      if (!billingConfigured() || !linkId)
        return json(res, 400, { error: 'Nothing to verify.' });
      const auth = Buffer.from(
        (process.env.RAZORPAY_KEY_ID || '') + ':' + (process.env.RAZORPAY_KEY_SECRET || '')
      ).toString('base64');
      const r = await fetch('https://api.razorpay.com/v1/payment_links/' + encodeURIComponent(linkId), {
        headers: { authorization: 'Basic ' + auth },
      });
      const link = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 400, { error: 'Could not check the payment.' });
      if (link.status !== 'paid')
        return json(res, 200, { paid: false, status: link.status || 'unknown' });
      const notes = (link.notes || {});
      if (notes.userId !== user.id) return json(res, 403, { error: 'This payment belongs to another account.' });
      const period = notes.period === 'year' ? 'year' : 'month';
      const planId = String(notes.planId || '');
      const already = db.data.payments.find((x) => x.paymentId === link.id);
      if (!already) {
        activatePlan(db, { userId: user.id, planId, months: period === 'year' ? 12 : 1, source: 'razorpay-verify', paymentId: link.id });
      }
      return json(res, 200, { paid: true, user: publicUser(db.findUserById(user.id)) });
    }

    if (req.method === 'POST' && p === '/api/billing/redeem') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const { data } = await readBody(req);
      const r = db.redeemCode(String(data.code || ''), user.id);
      if (!r.ok) return json(res, 400, { error: r.error });
      activatePlan(db, {
        userId: user.id,
        planId: r.code.plan,
        months: Math.max(1, Math.round(r.code.days / 30)),
        source: 'code',
        paymentId: 'code:' + r.code.code,
      });
      return json(res, 200, { ok: true, user: publicUser(db.findUserById(user.id)) });
    }

    if (req.method === 'POST' && p === '/api/billing/webhook') {
      const raw = await readBodyRaw(req);
      const sig = req.headers['x-razorpay-signature'];
      if (!verifyWebhookSignature(raw, sig)) return json(res, 400, { error: 'bad signature' });
      let evt = {};
      try {
        evt = JSON.parse(raw);
      } catch {}
      const e = (evt.payload && ((evt.payload.payment_link && evt.payload.payment_link.entity) || (evt.payload.payment && evt.payload.payment.entity))) || {};
      const notes = e.notes || {};
      const paymentId = e.payment_id || e.id || null;
      if (notes.userId && notes.planId && evt.event !== 'payment.failed') {
        const already = paymentId && db.data.payments.find((x) => x.paymentId === paymentId);
        if (!already) {
          activatePlan(db, {
            userId: notes.userId,
            planId: notes.planId,
            months: notes.period === 'year' ? 12 : 1,
            source: 'razorpay-webhook',
            paymentId,
          });
        }
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/billing/success') {
      const vf = url.searchParams.get('vf') || url.searchParams.get('razorpay_payment_link_reference_id') || '';
      const u = vf ? db.findUserById(vf) : null;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(successPageHtml(u ? u.email : ''));
    }

    // ── admin ──
    if (req.method === 'GET' && p === '/admin') {
      if (!adminOk(req, url))
        return json(res, 403, { error: 'Add ?token=YOUR_ADMIN_TOKEN to the URL.' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(adminPage(ADMIN_TOKEN, db, { serverUrl: SERVER_URL, defaultProvider: aiConfigured ? 'configured' : 'demo' }));
    }

    if (req.method === 'GET' && p === '/api/admin/users') {
      if (!adminOk(req, url)) return json(res, 403, { error: 'admin token required' });
      return json(res, 200, { users: db.data.users.map(publicUser) });
    }

    if (req.method === 'POST' && p === '/api/admin/activate') {
      if (!adminOk(req, url)) return json(res, 403, { error: 'admin token required' });
      const { data } = await readBody(req);
      const user = data.userId ? db.findUserById(String(data.userId)) : db.findUserByEmail(String(data.email || ''));
      if (!user) return json(res, 404, { error: 'No user with that email.' });
      const months = Math.max(1, Number(data.months) || 1);
      const u2 = activatePlan(db, { userId: user.id, planId: String(data.planId || 'starter'), months, source: 'admin' });
      return json(res, 200, { ok: true, user: publicUser(u2) });
    }

    if (req.method === 'POST' && p === '/api/admin/codes') {
      if (!adminOk(req, url)) return json(res, 403, { error: 'admin token required' });
      const { data } = await readBody(req);
      const codes = db.createCodes(
        String(data.planId || 'starter'),
        Math.max(1, Number(data.days) || 30),
        Math.min(50, Math.max(1, Number(data.count) || 1))
      );
      return json(res, 200, { ok: true, codes });
    }

    if (req.method === 'GET' && p === '/api/admin/codes') {
      if (!adminOk(req, url)) return json(res, 403, { error: 'admin token required' });
      return json(res, 200, { codes: db.data.codes });
    }

    // ── projects (logged-in users; each sees only their own) ──
    if (req.method === 'GET' && p === '/api/projects') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      return json(res, 200, { projects: ws.list(user.id) });
    }

    if (req.method === 'POST' && p === '/api/projects') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const { data } = await readBody(req);
      const meta = ws.create(String(data.name || 'my app').slice(0, 60), user.id);
      return json(res, 200, { project: meta });
    }

    let m;
    if ((m = p.match(/^\/api\/projects\/([\w.-]+)$/))) {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const id = m[1];
      const meta = ws.meta(id);
      if (meta.ownerId && meta.ownerId !== user.id)
        return json(res, 403, { error: 'This project belongs to another account.' });
      if (!meta.ownerId) {
        meta.ownerId = user.id;
        ws.saveMeta(id, meta);
      }
      if (req.method === 'GET') {
        const fresh = ws.meta(id);
        return json(res, 200, {
          project: { id: fresh.id, name: fresh.name, createdAt: fresh.createdAt, updatedAt: fresh.updatedAt },
          messages: fresh.messages || [],
          files: ws.tree(id),
        });
      }
      if (req.method === 'DELETE') {
        ws.remove(id);
        return json(res, 200, { ok: true });
      }
    }

    if ((m = p.match(/^\/api\/projects\/([\w.-]+)\/files$/)) && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const meta = ws.meta(m[1]);
      if (meta.ownerId && meta.ownerId !== user.id) return json(res, 403, { error: 'Not your project.' });
      return json(res, 200, { files: ws.tree(m[1]) });
    }

    if ((m = p.match(/^\/api\/projects\/([\w.-]+)\/file$/)) && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const meta = ws.meta(m[1]);
      if (meta.ownerId && meta.ownerId !== user.id) return json(res, 403, { error: 'Not your project.' });
      const file = url.searchParams.get('path') || 'index.html';
      return json(res, 200, { path: file, content: ws.readFile(m[1], file) });
    }

    if ((m = p.match(/^\/api\/projects\/([\w.-]+)\/chat$/)) && req.method === 'POST') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const id = m[1];
      const meta = ws.meta(id);
      if (meta.ownerId && meta.ownerId !== user.id)
        return json(res, 403, { error: 'This project belongs to another account.' });
      const { data } = await readBody(req);
      const prompt = String(data.prompt || '').trim();
      if (!prompt) return json(res, 400, { error: 'prompt is required' });

      const running = jobs.runningFor(id);
      if (running) return json(res, 200, { jobId: running.id, note: 'already running' });

      // Pick the brain: user's own key first, otherwise plan tier + quota.
      let provider = null;
      let usingByok = false;
      if (user.byok) {
        provider = providerFromByok(db.secret, user.byok);
        usingByok = !!provider;
      }
      if (!provider) {
        const state = usageState(user);
        if (state.remaining <= 0) {
          return json(res, 402, {
            error:
              "You've used all " + state.limit + ' generations on the ' + state.plan.name +
              ' plan. Upgrade in Settings → Account, redeem a code, or add your own API key for unlimited use.',
            needUpgrade: true,
          });
        }
        provider = resolveModelSpec(modelSpecForTier(state.plan.tier)) || new MockProvider();
        user.usage.gens = (user.usage.gens || 0) + 1;
        user.usage.gensTotal = (user.usage.gensTotal || 0) + 1;
        db.save();
      }

      const job = jobs.create(id, async (onEvent) => {
        if (provider.name === 'mock') {
          onEvent({
            type: 'assistant_text',
            text: 'Note: the server has no AI key configured, so it used the built-in demo brain.',
          });
        }
        const result = await runAgent({ provider, ws, projectId: id, prompt, onEvent });
        if (!usingByok && result.usage && (result.usage.tokensIn || result.usage.tokensOut)) {
          user.usage.tokensIn = (user.usage.tokensIn || 0) + result.usage.tokensIn;
          user.usage.tokensOut = (user.usage.tokensOut || 0) + result.usage.tokensOut;
          user.usage.costUsd =
            (user.usage.costUsd || 0) +
            estimateCostUsd(provider.model, result.usage.tokensIn, result.usage.tokensOut);
          db.save();
        }
      });
      return json(res, 200, { jobId: job.id, plan: effectivePlanId(user), byok: usingByok });
    }

    if ((m = p.match(/^\/api\/jobs\/([\w.-]+)$/)) && req.method === 'GET') {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in.' });
      const snap = jobs.snapshot(m[1]);
      if (!snap) return json(res, 404, { error: 'job not found' });
      return json(res, 200, snap);
    }

    // ── previews are public by project id (shareable links) ──
    if ((m = p.match(/^\/preview\/([\w.-]+)\/?(.*)$/)) && req.method === 'GET') {
      return serveStatic(ws.dir(m[1]), m[2] || '', res);
    }

    return json(res, 404, { error: 'Not found: ' + p });
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => {
  const banner = [
    '',
    '  ⚡ VibeForge server v2 (SaaS mode)',
    '  ──────────────────────────────────────────────────',
    '  Address     : ' + SERVER_URL,
    '  AI brains   : ' + (aiConfigured ? 'configured' : 'NOT configured → demo brain'),
    '    free    → ' + (modelSpecForTier('free') || '(demo)'),
    '    starter → ' + (modelSpecForTier('starter') || '(demo)'),
    '    pro     → ' + (modelSpecForTier('pro') || '(demo)'),
    '  Payments    : ' + (billingConfigured() ? 'Razorpay configured' : 'not configured yet'),
    '  Admin panel : ' + SERVER_URL + '/admin?token=' + ADMIN_TOKEN,
    '  ──────────────────────────────────────────────────',
    '  Plans: Free (10 gens) · Starter ₹' + PLANS.starter.monthly + '/mo · Pro ₹' + PLANS.pro.monthly + '/mo',
    '',
  ];
  console.log(banner.join('\n'));
});
