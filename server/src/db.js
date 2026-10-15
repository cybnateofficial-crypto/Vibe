// Tiny JSON-file database + crypto helpers. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class DB {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.file = path.join(dataRoot, 'db.json');
    fs.mkdirSync(dataRoot, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    this.data.users ||= [];
    this.data.payments ||= [];
    this.data.codes ||= [];
    this.data.seq ||= 0;

    const secretFile = path.join(dataRoot, 'secret.key');
    if (!fs.existsSync(secretFile)) {
      fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
      fs.chmodSync(secretFile, 0o600);
    }
    this.secret = (process.env.APP_SECRET || '').trim() || fs.readFileSync(secretFile, 'utf8').trim();
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  id(prefix) {
    return prefix + '_' + ++this.data.seq + '_' + crypto.randomBytes(3).toString('hex');
  }

  // ── users ──
  createUser(email, password) {
    const { salt, hash } = hashPassword(password);
    const user = {
      id: this.id('u'),
      email: email.toLowerCase().trim(),
      salt,
      hash,
      createdAt: Date.now(),
      plan: 'free',
      planExpiresAt: null,
      byok: null,
      usage: { month: currentMonth(), gens: 0, gensTotal: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  findUserByEmail(email) {
    return this.data.users.find((u) => u.email === String(email || '').toLowerCase().trim()) || null;
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  // ── activation codes ──
  createCodes(plan, days, count) {
    const made = [];
    for (let i = 0; i < count; i++) {
      const code =
        'VF-' +
        crypto.randomBytes(3).toString('hex').toUpperCase() +
        '-' +
        crypto.randomBytes(3).toString('hex').toUpperCase();
      this.data.codes.push({ code, plan, days, usedBy: null, usedAt: null, createdAt: Date.now() });
      made.push(code);
    }
    this.save();
    return made;
  }

  redeemCode(code, userId) {
    const c = this.data.codes.find(
      (x) => x.code.toUpperCase() === String(code || '').toUpperCase().trim()
    );
    if (!c) return { ok: false, error: 'That code does not exist.' };
    if (c.usedBy) return { ok: false, error: 'That code has already been used.' };
    c.usedBy = userId;
    c.usedAt = Date.now();
    this.save();
    return { ok: true, code: c };
  }

  // ── payments ──
  addPayment(p) {
    const rec = { id: this.id('pay'), createdAt: Date.now(), ...p };
    this.data.payments.push(rec);
    this.save();
    return rec;
  }
}

// ── password hashing (scrypt) ──

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// ── stateless auth tokens (HMAC signed) ──

export function signToken(secret, userId, days = 60) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + days * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

export function verifyToken(secret, token) {
  try {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || Date.now() > data.exp) return null;
    return data.uid;
  } catch {
    return null;
  }
}

// ── encrypt/decrypt (for storing users' BYOK keys at rest) ──

export function encrypt(secret, text) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + ct.toString('hex') + ':' + cipher.getAuthTag().toString('hex');
}

export function decrypt(secret, blob) {
  const [ivH, ctH, tagH] = String(blob || '').split(':');
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]).toString('utf8');
}

export function currentMonth() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
