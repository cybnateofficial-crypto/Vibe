// Razorpay billing: payment links + webhook verification + plan activation.
import crypto from 'node:crypto';
import { getPlan, PLANS } from './plans.js';

const KEY_ID = () => (process.env.RAZORPAY_KEY_ID || '').trim();
const KEY_SECRET = () => (process.env.RAZORPAY_KEY_SECRET || '').trim();
const WEBHOOK_SECRET = () => (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const SERVER_URL = () => (process.env.SERVER_URL || 'http://localhost:8787').replace(/\/+$/, '');

export function billingConfigured() {
  return !!(KEY_ID() && KEY_SECRET());
}

export async function createPaymentLink({ user, planId, period }) {
  const plan = PLANS[planId];
  if (!plan || planId === 'free') throw new Error('Unknown plan: ' + planId);
  if (!billingConfigured())
    throw new Error(
      'Payments are not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env (test mode keys work).'
    );

  const months = period === 'year' ? 12 : 1;
  const amount = period === 'year' ? plan.yearly : plan.monthly;

  const body = {
    amount: amount * 100, // paise
    currency: 'INR',
    accept_partial: false,
    description: 'VibeForge ' + plan.name + ' — ' + (period === 'year' ? '1 year' : '1 month'),
    reference_id: user.id + '_' + planId + '_' + period,
    notes: { userId: user.id, planId, period, email: user.email },
    callback_url: SERVER_URL() + '/billing/success?vf=' + user.id,
    callback_method: 'get',
    expire_by: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24h to pay
  };

  const auth = Buffer.from(KEY_ID() + ':' + KEY_SECRET()).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + auth },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.description) || 'Razorpay error ' + res.status;
    throw new Error(msg);
  }
  return {
    url: data.short_url,
    id: data.id,
    amount,
    months,
    keyId: KEY_ID(),
  };
}

// Verify the X-Razorpay-Signature header against the raw webhook body.
export function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET()) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET()).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || '')));
  } catch {
    return false;
  }
}

// Grant/extend a plan. Creates a payment record too.
export function activatePlan(db, { userId, planId, months, source, paymentId }) {
  const user = db.findUserById(userId);
  if (!user) throw new Error('User not found: ' + userId);
  const plan = getPlan(planId);
  const base =
    user.plan === planId && user.planExpiresAt && user.planExpiresAt > Date.now()
      ? user.planExpiresAt
      : Date.now();
  user.plan = planId;
  user.planExpiresAt = base + months * 30 * 864e5;
  db.save();
  db.addPayment({
    userId,
    email: user.email,
    planId,
    months,
    source: source || 'manual',
    paymentId: paymentId || null,
    amountINR: months === 12 ? plan.yearly : plan.monthly * months,
    status: 'paid',
  });
  return user;
}

export function successPageHtml(email) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment received</title><style>
body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0d12;color:#eaeef7;display:grid;place-items:center;min-height:100vh}
.card{max-width:420px;padding:36px;border:1px solid #242c3f;border-radius:20px;background:#12161f;text-align:center}
h1{font-size:22px;margin:0 0 10px} p{color:#c6cddd;font-size:14px;line-height:1.6}
.big{font-size:44px;margin-bottom:6px}
</style></head><body><div class="card">
<div class="big">🎉</div>
<h1>Payment received!</h1>
<p>Your plan is active${email ? ' for <b>' + email + '</b>' : ''}.</p>
<p><b>Go back to the VibeForge app</b> and open Settings — your plan will appear within a few seconds.</p>
</div></body></html>`;
}
