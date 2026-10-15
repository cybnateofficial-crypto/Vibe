// "Skills" = markdown playbooks injected into the agent prompt when keywords match.
// This mirrors how modern coding agents (and repos like morluto/rea) ship skill packs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

export function loadSkills() {
  try {
    return fs
      .readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const raw = fs.readFileSync(path.join(SKILLS_DIR, f), 'utf8');
        let body = raw;
        let keywords = [];
        const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
        if (m) {
          body = raw.slice(m[0].length);
          for (const line of m[1].split('\n')) {
            const kv = line.match(/^keywords\s*:\s*(.+)$/);
            if (kv) {
              keywords = kv[1]
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            }
          }
        }
        return { name: f, keywords, body };
      });
  } catch {
    return [];
  }
}

export function matchSkills(prompt, max = 2) {
  const text = (prompt || '').toLowerCase();
  return loadSkills()
    .map((s) => ({ ...s, score: s.keywords.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.body);
}
