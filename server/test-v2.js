// VibeForge v2 end-to-end SaaS test
const BASE = 'http://localhost:8787';
const ADMIN = 'testadmin';
let pass = 0,
  fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? ' → ' + extra : ''));
  }
}

async function api(path, { method = 'GET', body, token, admin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (admin) headers['x-admin-token'] = ADMIN;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const crypto = await import('node:crypto');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n── VibeForge v2 test run ──\n');

  // health
  let r = await api('/health');
  check('health endpoint', r.status === 200 && r.data.version === 2, JSON.stringify(r.data));

  // signup validation
  r = await api('/api/auth/signup', { method: 'POST', body: { email: 'bad', password: '123' } });
  check('signup rejects bad email', r.status === 400);

  // signup u1
  r = await api('/api/auth/signup', { method: 'POST', body: { email: 'u1@test.com', password: 'secret1' } });
  check('signup user1', r.status === 200 && !!r.data.token, JSON.stringify(r.data));
  const t1 = r.data.token;

  // duplicate
  r = await api('/api/auth/signup', { method: 'POST', body: { email: 'u1@test.com', password: 'secret1' } });
  check('signup rejects duplicate', r.status === 400);

  // wrong password
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'u1@test.com', password: 'wrong' } });
  check('login rejects wrong password', r.status === 401);

  // login ok
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'u1@test.com', password: 'secret1' } });
  check('login works', r.status === 200);

  // me
  r = await api('/api/auth/me', { token: t1 });
  check('me shows free plan + 10 limit', r.status === 200 && r.data.user.plan === 'free' && r.data.user.usage.limit === 10, JSON.stringify(r.data.user?.usage));
  check('me includes plan catalog', Array.isArray(r.data.plans) && r.data.plans.some((p) => p.id === 'pro'));

  // unauthenticated
  r = await api('/api/projects');
  check('projects require login', r.status === 401);

  // create project
  r = await api('/api/projects', { method: 'POST', token: t1, body: { name: 'my first app' } });
  check('create project', r.status === 200 && !!r.data.project.id, JSON.stringify(r.data));
  const projId = r.data.project.id;

  // chat → generation (mock brain)
  r = await api('/api/projects/' + projId + '/chat', { method: 'POST', token: t1, body: { prompt: 'build a todo app' } });
  check('start chat job', r.status === 200 && !!r.data.jobId, JSON.stringify(r.data));
  const jobId = r.data.jobId;

  let job = null;
  for (let i = 0; i < 30; i++) {
    await sleep(600);
    r = await api('/api/jobs/' + jobId, { token: t1 });
    job = r.data;
    if (job.status !== 'running') break;
  }
  check('job completed', job && job.status === 'done', JSON.stringify(job?.status));
  check('agent wrote files', job && job.events.some((e) => e.type === 'tool_call' && e.name === 'write_file'));

  // usage meter
  r = await api('/api/auth/me', { token: t1 });
  check('quota consumed (1/10)', r.data.user.usage.used === 1 && r.data.user.usage.remaining === 9, JSON.stringify(r.data.user.usage));

  // preview serves
  const pv = await fetch(BASE + '/preview/' + projId + '/');
  const html = await pv.text();
  check('preview serves generated html', pv.status === 200 && html.includes('<html'), 'status ' + pv.status);

  // isolation: user2 cannot touch user1's project
  r = await api('/api/auth/signup', { method: 'POST', body: { email: 'u2@test.com', password: 'secret2' } });
  const t2 = r.data.token;
  r = await api('/api/projects/' + projId, { token: t2 });
  check('project isolation (u2 blocked from u1 project)', r.status === 403, 'status ' + r.status);
  r = await api('/api/projects', { token: t2 });
  check('u2 sees zero projects', r.data.projects.length === 0, JSON.stringify(r.data.projects.length));

  // billing not configured → friendly error
  r = await api('/api/billing/checkout', { method: 'POST', token: t1, body: { planId: 'starter', period: 'month' } });
  check('checkout gives clear error when razorpay not set', r.status === 500 && /Razorpay|Payments are not configured/.test(r.data.error), JSON.stringify(r.data));

  // admin: activate pro for u1
  r = await api('/api/admin/activate', { method: 'POST', admin: true, body: { email: 'u1@test.com', planId: 'pro', months: 1 } });
  check('admin activates pro', r.status === 200 && r.data.user.plan === 'pro', JSON.stringify(r.data));
  r = await api('/api/auth/me', { token: t1 });
  check('u1 is now pro with 150 limit', r.data.user.plan === 'pro' && r.data.user.usage.limit === 150, JSON.stringify(r.data.user.usage));

  // admin requires token
  r = await api('/api/admin/activate', { method: 'POST', body: { email: 'u1@test.com', planId: 'pro' } });
  check('admin endpoints locked without token', r.status === 403);

  // codes
  r = await api('/api/admin/codes', { method: 'POST', admin: true, body: { planId: 'starter', days: 30, count: 2 } });
  check('admin creates codes', r.status === 200 && r.data.codes.length === 2, JSON.stringify(r.data));
  const code = r.data.codes[0];
  r = await api('/api/billing/redeem', { method: 'POST', token: t2, body: { code } });
  check('u2 redeems code → starter', r.status === 200 && r.data.user.plan === 'starter', JSON.stringify(r.data));
  r = await api('/api/billing/redeem', { method: 'POST', token: t2, body: { code } });
  check('code cannot be reused', r.status === 400);

  // webhook with valid signature
  const whSecret = 'testwhsec';
  r = await api('/api/auth/me', { token: t2 });
  const u2id = r.data.user.id;
  const evt = {
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_TEST123',
          payment_id: 'pay_TEST123',
          notes: { userId: u2id, planId: 'pro', period: 'year', email: 'u2@test.com' },
        },
      },
    },
  };
  const raw = JSON.stringify(evt);
  const sig = crypto.createHmac('sha256', whSecret).update(raw).digest('hex');
  let wr = await fetch(BASE + '/api/billing/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
    body: raw,
  });
  check('webhook accepts valid signature', wr.status === 200, 'status ' + wr.status);
  r = await api('/api/auth/me', { token: t2 });
  check('u2 upgraded to pro for 1 year via webhook', r.data.user.plan === 'pro' && r.data.user.planExpiresAt > Date.now() + 300 * 864e5, JSON.stringify({ plan: r.data.user.plan, exp: r.data.user.planExpiresAt }));

  // webhook replay (idempotent)
  wr = await fetch(BASE + '/api/billing/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
    body: raw,
  });
  check('webhook replay is idempotent', wr.status === 200);

  // bad signature rejected
  wr = await fetch(BASE + '/api/billing/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
    body: raw,
  });
  check('webhook rejects bad signature', wr.status === 400);

  // BYOK
  r = await api('/api/auth/byok', { method: 'POST', token: t1, body: { provider: 'anthropic', key: 'sk-ant-test-key-0123456789' } });
  check('byok saved', r.status === 200, JSON.stringify(r.data));
  r = await api('/api/auth/me', { token: t1 });
  check('me reports byok', r.data.user.byok && r.data.user.byok.provider === 'anthropic');
  r = await api('/api/auth/byok', { method: 'DELETE', token: t1 });
  check('byok removed', r.status === 200);
  r = await api('/api/auth/byok', { method: 'POST', token: t1, body: { provider: 'nope', key: 'sk-ant-test-key-0123456789' } });
  check('byok rejects bad provider', r.status === 400);

  // admin page
  const ap = await fetch(BASE + '/admin?token=' + ADMIN);
  const apHtml = await ap.text();
  check('admin dashboard renders', ap.status === 200 && apHtml.includes('VibeForge Admin'));
  const apBad = await fetch(BASE + '/admin?token=wrong');
  check('admin page locked without right token', apBad.status === 403);

  console.log('\n── ' + pass + ' passed, ' + fail + ' failed ──\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST CRASH:', e);
  process.exit(1);
});
