// Minimal static file server for project previews.
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export function serveStatic(rootDir, rel, res) {
  const cleanRel = path.normalize(rel || '').replace(/^([.][.][/\\])+/, '');
  let full = path.join(rootDir, cleanRel);
  if (!full.startsWith(rootDir)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Forbidden');
  }
  try {
    if (fs.statSync(full).isDirectory()) full = path.join(full, 'index.html');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found — this project has no files yet.');
  }
  let data;
  try {
    data = fs.readFileSync(full);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(data);
}
