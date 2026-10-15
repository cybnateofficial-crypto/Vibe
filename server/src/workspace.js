// Project storage: each project is a folder under workspaces/, metadata in data/projects.json
// v2: projects have an ownerId so every user only sees their own apps.
import fs from 'node:fs';
import path from 'node:path';

const IGNORE = new Set(['node_modules', '.git', '.DS_Store', '.expo']);

export class Workspace {
  constructor(wsRoot, dataRoot) {
    this.wsRoot = wsRoot;
    this.dataRoot = dataRoot;
    this.metaFile = path.join(dataRoot, 'projects.json');
    fs.mkdirSync(wsRoot, { recursive: true });
    fs.mkdirSync(dataRoot, { recursive: true });
    if (!fs.existsSync(this.metaFile)) {
      fs.writeFileSync(this.metaFile, JSON.stringify({ projects: [] }, null, 2));
    }
  }

  _db() {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch {
      return { projects: [] };
    }
  }

  _save(db) {
    fs.writeFileSync(this.metaFile, JSON.stringify(db, null, 2));
  }

  list(ownerId) {
    return this._db()
      .projects.filter((p) => !ownerId || p.ownerId === ownerId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        ownerId: p.ownerId || null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        messageCount: (p.messages || []).length,
      }));
  }

  meta(id) {
    const p = this._db().projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found: ' + id);
    return p;
  }

  saveMeta(id, meta) {
    const db = this._db();
    const i = db.projects.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('Project not found: ' + id);
    meta.updatedAt = Date.now();
    db.projects[i] = meta;
    this._save(db);
  }

  create(name, ownerId) {
    const base =
      (name || 'untitled')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20) || 'app';
    const id = base + '-' + Math.random().toString(36).slice(2, 6);
    const meta = {
      id,
      name: name || 'Untitled App',
      ownerId: ownerId || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    const db = this._db();
    db.projects.unshift(meta);
    this._save(db);
    fs.mkdirSync(this.dir(id), { recursive: true });
    return meta;
  }

  remove(id) {
    const db = this._db();
    db.projects = db.projects.filter((p) => p.id !== id);
    this._save(db);
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }

  dir(id) {
    return path.join(this.wsRoot, id);
  }

  safePath(id, rel) {
    const root = this.dir(id);
    const full = path.resolve(root, rel || '');
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error('Path escapes the workspace: ' + rel);
    }
    return full;
  }

  writeFile(id, rel, content) {
    if (typeof rel !== 'string' || !rel.trim()) throw new Error('path must be a non-empty string');
    if (typeof content !== 'string') throw new Error('content must be a string');
    if (content.length > 400_000) throw new Error('File too large (max 400KB)');
    const full = this.safePath(id, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return content.length;
  }

  readFile(id, rel) {
    const full = this.safePath(id, rel);
    return fs.readFileSync(full, 'utf8');
  }

  deleteFile(id, rel) {
    fs.rmSync(this.safePath(id, rel), { force: true });
  }

  tree(id) {
    const out = [];
    const walk = (dir, prefix) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (IGNORE.has(e.name)) continue;
        const rel = prefix ? prefix + '/' + e.name : e.name;
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), rel);
        } else {
          let size = 0;
          try {
            size = fs.statSync(path.join(dir, e.name)).size;
          } catch {}
          out.push({ path: rel, size });
        }
      }
    };
    walk(this.dir(id), '');
    return out;
  }

  isEmpty(id) {
    return this.tree(id).length === 0;
  }
}
