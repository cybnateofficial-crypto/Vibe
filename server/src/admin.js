// Admin dashboard — served at /admin?token=...  (for the owner only)
import { PLANS, effectivePlanId, usageState } from './plans.js';

export function adminPage(token, db, info) {
  const users = db.data.users.map((u) => {
    const plan = effectivePlanId(u);
    const us = usageState(u);
    return {
      id: u.id,
      email: u.email,
      plan,
      planExpiresAt: u.planExpiresAt,
      used: us.used,
      limit: us.limit,
      gensTotal: u.usage.gensTotal || 0,
      tokensIn: u.usage.tokensIn || 0,
      tokensOut: u.usage.tokensOut || 0,
      costUsd: u.usage.costUsd || 0,
      byok: u.byok ? u.byok.provider : null,
      createdAt: u.createdAt,
    };
  });
  const payments = db.data.payments.slice(-40).reverse();
  const codes = db.data.codes.slice(-30).reverse();
  const since = Date.now() - 30 * 864e5;
  const monthRevenue = db.data.payments
    .filter((p) => p.createdAt > since)
    .reduce((n, p) => n + (p.amountINR || 0), 0);
  const activeSubs = users.filter((u) => u.plan !== 'free').length;

  const data = JSON.stringify({ users, payments, codes }).replace(/</g, '\\u003c');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VibeForge Admin</title><style>
:root{--bg:#0b0d12;--card:#141926;--border:#232b3e;--text:#eaeef7;--sub:#8b93a7;--accent:#7c5cff;--green:#3ddc97}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,sans-serif;padding:18px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--sub);font-size:13px;margin-bottom:16px}
.cards{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 18px;min-width:130px}
.card .n{font-size:22px;font-weight:700}.card .l{color:var(--sub);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;font-size:12.5px;margin-bottom:18px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
th{color:var(--sub);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
tr:last-child td{border-bottom:none}.wrap{overflow-x:auto;margin-bottom:18px}
.badge{background:#241e4e;color:#b7a6ff;border-radius:999px;padding:2px 9px;font-size:11px}
input,select,button{font-family:inherit;font-size:13px;padding:9px 11px;border-radius:10px;border:1px solid var(--border);background:#101521;color:var(--text)}
button{background:var(--accent);border:none;color:#fff;font-weight:600;cursor:pointer}
button.ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
h2{font-size:15px;margin:18px 0 8px}
.muted{color:var(--sub);font-size:12px}
</style></head><body>
<h1>⚡ VibeForge Admin</h1>
<div class="sub">server: ${info.serverUrl} · provider default: ${info.defaultProvider} · plans: free / starter ₹${PLANS.starter.monthly} / pro ₹${PLANS.pro.monthly}</div>

<div class="cards">
  <div class="card"><div class="n">${users.length}</div><div class="l">total users</div></div>
  <div class="card"><div class="n">${activeSubs}</div><div class="l">paying users</div></div>
  <div class="card"><div class="n">₹${monthRevenue}</div><div class="l">revenue · last 30 days</div></div>
  <div class="card"><div class="n">$${users.reduce((n, u) => n + u.costUsd, 0).toFixed(2)}</div><div class="l">est. AI cost (all time)</div></div>
</div>

<h2>Quick actions</h2>
<div class="row">
  <input id="a-email" placeholder="user email" />
  <select id="a-plan"><option value="starter">starter</option><option value="pro">pro</option></select>
  <input id="a-months" value="1" style="width:70px" />
  <button onclick="activate()">Activate plan</button>
</div>
<div class="row">
  <select id="c-plan"><option value="starter">starter</option><option value="pro">pro</option></select>
  <input id="c-days" value="30" style="width:80px" />
  <input id="c-count" value="5" style="width:70px" />
  <button onclick="makeCodes()">Make activation codes</button>
  <span class="muted">codes let a user activate a plan themselves: Settings → Account → Redeem code</span>
</div>
<div id="out" class="muted"></div>

<h2>Users</h2>
<div class="wrap"><table id="users"></table></div>

<h2>Payments (latest 40)</h2>
<div class="wrap"><table id="pays"></table></div>

<h2>Activation codes (latest 30)</h2>
<div class="wrap"><table id="codes"></table></div>

<script>
const TOKEN=${JSON.stringify(token)};
const D=${data};
const fmt=d=>d?new Date(d).toLocaleDateString():'—';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function tbl(el,head,rows){el.innerHTML='<tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+(rows.length?rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+head.length+'" class="muted">nothing yet</td></tr>');}
tbl(users,['email','plan','expires','used','total gens','tokens in','tokens out','est $','byok','joined'],
 D.users.map(u=>[esc(u.email),'<span class=badge>'+u.plan+'</span>',fmt(u.planExpiresAt),u.used+'/'+u.limit,u.gensTotal,u.tokensIn,u.tokensOut,'$'+u.costUsd.toFixed(3),u.byok||'—',fmt(u.createdAt)]));
tbl(pays,['date','email','plan','months','₹','source','payment id'],
 D.payments.map(p=>[fmt(p.createdAt),esc(p.email),p.planId,p.months,p.amountINR,esc(p.source),esc(p.paymentId||'—')]));
tbl(codes,['code','plan','days','used by','created'],
 D.codes.map(c=>['<b>'+esc(c.code)+'</b>',c.plan,c.days,esc(c.usedBy||'—'),fmt(c.createdAt)]));
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-admin-token':TOKEN},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;}
async function activate(){try{const j=await api('/api/admin/activate',{email:a_email.value,planId:a_plan.value,months:Number(a_months.value)||1});document.getElementById('out').textContent='✓ activated '+j.user.email+' on '+j.user.plan+' until '+fmt(j.user.planExpiresAt)+' — refresh to see';}catch(e){document.getElementById('out').textContent='✗ '+e.message;}}
async function makeCodes(){try{const j=await api('/api/admin/codes',{planId:c_plan.value,days:Number(c_days.value)||30,count:Number(c_count.value)||1});document.getElementById('out').innerHTML='✓ new codes: <b>'+j.codes.join('</b>, <b>')+'</b>';}catch(e){document.getElementById('out').textContent='✗ '+e.message;}}
</script></body></html>`;
}
