// Plans, quotas and pricing. Change prices/limits here — everything else reads from this.
import { currentMonth } from './db.js';

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearly: 0,
    genLimit: 10,
    period: 'total', // lifetime generations
    tier: 'free',
    tagline: 'Try it out — 10 generations on the fastest model',
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    monthly: 299,
    yearly: 2499,
    genLimit: 60,
    period: 'month',
    tier: 'starter',
    tagline: '60 generations / month · fast model',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 799,
    yearly: 6999,
    genLimit: 150,
    period: 'month',
    tier: 'pro',
    tagline: '150 generations / month · flagship model',
  },
};

export function getPlan(id) {
  return PLANS[id] || PLANS.free;
}

// Which AI model each tier uses. Configured in .env (format: "provider:model-id").
export function modelSpecForTier(tier) {
  const map = {
    free: process.env.MODEL_FREE,
    starter: process.env.MODEL_STARTER,
    pro: process.env.MODEL_PRO,
  };
  return (map[tier] || '').trim() || null;
}

// Plan is active only while planExpiresAt is in the future; otherwise downgrade to free.
export function effectivePlanId(user) {
  if (!user) return 'free';
  if (user.plan === 'free') return 'free';
  if (user.planExpiresAt && user.planExpiresAt > Date.now()) return user.plan;
  return 'free';
}

export function usageState(user) {
  const plan = getPlan(effectivePlanId(user));
  user.usage = user.usage || { month: currentMonth(), gens: 0, gensTotal: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const m = currentMonth();
  if (user.usage.month !== m) {
    user.usage.month = m;
    user.usage.gens = 0;
  }
  const used = plan.period === 'total' ? user.usage.gensTotal || 0 : user.usage.gens || 0;
  return { used, limit: plan.genLimit, remaining: Math.max(0, plan.genLimit - used), plan };
}

// Rough price table (USD per 1M tokens) for the admin dashboard's cost estimate.
const PRICE_TABLE = [
  { match: /opus/i, in: 5, out: 25 },
  { match: /sonnet/i, in: 2, out: 10 },
  { match: /haiku/i, in: 1, out: 5 },
  { match: /flash/i, in: 0.3, out: 2.5 },
  { match: /gpt-5/i, in: 1.25, out: 10 },
  { match: /gpt-4o/i, in: 2.5, out: 10 },
  { match: /mini|instant/i, in: 0.6, out: 2.4 },
];

export function estimateCostUsd(modelId, tokensIn, tokensOut) {
  const row = PRICE_TABLE.find((r) => r.match.test(String(modelId || ''))) || { in: 1, out: 5 };
  return (tokensIn / 1e6) * row.in + (tokensOut / 1e6) * row.out;
}
