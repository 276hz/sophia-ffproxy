// language: JavaScript, file: api/ffproxy.js, runtime: Vercel Node 20+
// Route priority:
//   1. /ffproxy/<platform>/<version>/fileinfo       → manifest CSV
//   2. /ffproxy/<platform>/<version>/<bundle>       → bundle bytes
//   3. /ffproxy/<platform>/<version>/<anything>     → {valid:true,...} JSON (verify, key, license...)
//   4. /ffproxy  hoặc  /ffproxy?p=<bundle>          → legacy query-style (giữ cho tương thích)
//   5. /api/* /verify* /license* /key* ...          → {valid:true,...} JSON
//   6. path khác                                     → SPA fallback
const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(process.cwd(), 'data');
const FILES    = path.join(ROOT, 'files');
const MANIFEST = path.join(ROOT, 'manifest.csv');
const SPA      = path.join(ROOT, 'spa.html');

const HELMET = {
  'cross-origin-opener-policy':        'same-origin',
  'cross-origin-resource-policy':      'same-origin',
  'origin-agent-cluster':              '?1',
  'referrer-policy':                   'no-referrer',
  'strict-transport-security':         'max-age=31536000; includeSubDomains',
  'x-content-type-options':            'nosniff',
  'x-dns-prefetch-control':            'off',
  'x-download-options':                'noopen',
  'x-permitted-cross-domain-policies': 'none',
  'x-xss-protection':                  '0',
};

function common(res, vary) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'GET,HEAD,POST,PUT,OPTIONS');
  res.setHeader('access-control-allow-headers', 'Range,If-None-Match,If-Modified-Since,Content-Type,Authorization,X-Api-Key,X-Key,X-Token');
  res.setHeader('vary', vary || 'Origin');
  for (const k in HELMET) res.setHeader(k, HELMET[k]);
}

function etag(size, mtimeMs) {
  return 'W/"' + size.toString(16) + '-' + Math.floor(mtimeMs).toString(16) + '"';
}

function notFound(res) {
  res.status(404);
  res.setHeader('content-length', '0');
  res.end();
}

function serveFile(req, res, filePath, contentType, cacheControl) {
  const stat = fs.statSync(filePath);
  const tag = etag(stat.size, stat.mtimeMs);
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', cacheControl);
  res.setHeader('etag', tag);
  res.setHeader('accept-ranges', 'bytes');
  if (req.headers['if-none-match'] === tag) { res.status(304).end(); return; }
  res.setHeader('content-length', String(stat.size));
  res.status(200);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(filePath).pipe(res);
}

function fakeValidation() {
  const now = Math.floor(Date.now() / 1000);
  return {
    status: 'ok', success: true, valid: true, ok: true,
    authorized: true, activated: true, active: true,
    license: 'active', tier: 'premium', plan: 'lifetime',
    message: 'activated', code: 0, code_msg: 'success',
    key: 'PREMIUM-ACTIVE',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwcmVtaXVtIiwidmFsaWQiOnRydWUsImV4cCI6OTk5OTk5OTk5OX0.fake',
    expires_at: now + 31536000,
    expires: '2099-12-31T23:59:59Z',
    subscription: { status: 'active', plan: 'lifetime', expires: null },
    user: { id: 1, username: 'premium', role: 'admin', tier: 'premium' },
    data: { valid: true, activated: true, tier: 'premium', active: true },
    result: { valid: true, ok: true, status: 'active' },
    features: ['esp','aim','speed','wallhack','fly','infinite_ammo','no_recoil','anti_ban'],
  };
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('content-length', String(Buffer.byteLength(body)));
  res.status(200).end(body);
}

// Thử resolve bundle path trong data/files/
function tryBundle(resource) {
  const clean = String(resource).replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.includes('\0')) return null;
  const local = path.resolve(FILES, clean);
  if (!local.startsWith(FILES + path.sep)) return null;
  if (!fs.existsSync(local) || !fs.statSync(local).isFile()) return null;
  return local;
}

const API_PATTERNS = [
  /^\/api(\/|$)/,
  /^\/v[0-9]+(\/|$)/,
  /^\/verify(\/|$|\.)/,
  /^\/auth(\/|$|\.)/,
  /^\/license(\/|$|\.)/,
  /^\/activate(\/|$|\.)/,
  /^\/activation(\/|$|\.)/,
  /^\/check([-_]?key|\/|$|\.)/,
  /^\/key(\/|$|\.)/,
  /^\/validat/,
  /^\/user(\/|$|\.)/,
  /^\/account(\/|$|\.)/,
  /^\/login(\/|$|\.)/,
  /^\/session(\/|$|\.)/,
  /^\/token(\/|$|\.)/,
];
function isApiPath(p) {
  for (const re of API_PATTERNS) if (re.test(p)) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { common(res); res.status(204).end(); return; }

  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;

  // ============ 1-3. /ffproxy/<platform>/<version>/<resource> ============
  const pathMatch = pathname.match(/^\/ffproxy\/([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (pathMatch) {
    const platform = pathMatch[1];
    const version  = pathMatch[2];
    const resource = pathMatch[3] || '';

    // 1a. fileinfo → manifest CSV
    if (resource === 'fileinfo') {
      common(res, 'Origin');
      if (!fs.existsSync(MANIFEST)) { notFound(res); return; }
      serveFile(req, res, MANIFEST, 'text/plain; charset=utf-8', 'no-store, no-cache, must-revalidate');
      return;
    }

    // 1b. bundle file
    if (resource) {
      const local = tryBundle(resource);
      if (local) {
        common(res, 'Origin');
        serveFile(req, res, local, 'application/octet-stream', 'no-store, no-cache, must-revalidate');
        return;
      }
    }

    // 1c. mọi thứ khác dưới /ffproxy/<x>/<y>/... → giả JSON (verify, key, activate...)
    common(res, 'Origin');
    sendJson(res, fakeValidation());
    return;
  }

  // ============ 4. /ffproxy legacy query-style ============
  if (pathname === '/ffproxy' || pathname === '/ffproxy/') {
    common(res, 'Origin');
    const p = url.searchParams.get('p');

    if (p == null || p === '' || p === '/' || p === '//') {
      if (!fs.existsSync(MANIFEST)) { notFound(res); return; }
      serveFile(req, res, MANIFEST, 'text/plain; charset=utf-8', 'no-store, no-cache, must-revalidate');
      return;
    }
    const local = tryBundle(p);
    if (!local) { notFound(res); return; }
    serveFile(req, res, local, 'application/octet-stream', 'no-store, no-cache, must-revalidate');
    return;
  }

  // ============ 5. API validate fake ============
  if (isApiPath(pathname)) {
    common(res, 'Origin');
    sendJson(res, fakeValidation());
    return;
  }

  // ============ 6. SPA fallback ============
  common(res, 'Origin, accept-encoding');
  if (!fs.existsSync(SPA)) {
    const minimal = '<!doctype html><html><head><meta charset="UTF-8"/></head><body></body></html>';
    res.setHeader('content-type', 'text/html; charset=UTF-8');
    res.setHeader('content-length', String(Buffer.byteLength(minimal)));
    res.status(200).end(minimal);
    return;
  }
  serveFile(req, res, SPA, 'text/html; charset=UTF-8', 'no-store, max-age=0, must-revalidate');
};
