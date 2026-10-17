// language: JavaScript, file: gen-manifest.js, runtime: Node 18+
// Sinh data/manifest.csv từ data/files/. File trong files/ là gzip.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DATA     = path.join(__dirname, 'data');
const FILES    = path.join(DATA, 'files');
const MANIFEST = path.join(DATA, 'manifest.csv');

function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir)) {
    const full = path.join(dir, e);
    const rel  = base ? base + '/' + e : e;
    if (fs.statSync(full).isDirectory()) out.push.apply(out, walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

function b64sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('base64');
}

if (!fs.existsSync(FILES)) { console.error('missing data/files/'); process.exit(1); }
const entries = walk(FILES, '').sort((a, b) => a.rel.localeCompare(b.rel));
const lines = [];
for (const f of entries) {
  const comp = fs.readFileSync(f.full);
  let orig;
  try { orig = zlib.gunzipSync(comp); } catch (e) { orig = comp; }
  lines.push([
    f.rel,
    b64sha1(orig), String(orig.length), '0',
    b64sha1(comp), String(comp.length),
    'True', '0',
  ].join(','));
}
fs.writeFileSync(MANIFEST, lines.join('\n') + (lines.length ? '\n' : ''));
console.log('wrote ' + lines.length + ' entries → ' + MANIFEST);
lines.forEach(l => console.log('  ' + l));
