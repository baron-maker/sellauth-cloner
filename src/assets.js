// assets.js - Varliklari (css/js/img/font) indirir, yerel dosya adlari uretir,
// CSS icindeki url()/@import referanslarini yeniden yazar.
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchResource, resolveUrl } from './fetcher.js';

const EXT_BY_MIME = {
  'text/css': '.css',
  'application/javascript': '.js',
  'text/javascript': '.js',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'font/woff2': '.woff2',
  'font/woff': '.woff',
  'font/ttf': '.ttf',
  'application/font-woff': '.woff',
};

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80);
}

function fileNameFor(url, contentType, usedNames) {
  let base;
  try {
    const u = new URL(url);
    base = path.basename(u.pathname);
  } catch {
    base = '';
  }
  let ext = path.extname(base).toLowerCase();
  if (!ext && contentType) {
    const mime = contentType.split(';')[0].trim();
    ext = EXT_BY_MIME[mime] || '';
  }
  let stem = sanitize(path.basename(base, path.extname(base))) || 'asset';
  if (!ext) ext = '';
  let candidate = stem + ext;
  // benzersizlestir
  if (usedNames.has(candidate)) {
    const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 6);
    candidate = `${stem}-${hash}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

/**
 * AssetManager: her URL'yi bir kez indirir, yerel ada esler.
 */
export class AssetManager {
  constructor({ log = () => {} } = {}) {
    this.map = new Map(); // absoluteUrl -> { localName, buffer, contentType }
    this.usedNames = new Set(['built.css', 'custom.css', 'style.css', 'script.js']);
    this.log = log;
  }

  /** Bir URL'yi indirir ve yerel ada esler. Zaten varsa mevcut adi doner. */
  async add(absUrl) {
    if (!absUrl) return null;
    if (this.map.has(absUrl)) return this.map.get(absUrl).localName;
    const res = await fetchResource(absUrl);
    if (!res.ok || res.buffer.length === 0) {
      this.log(`  ! indirilemedi: ${absUrl} (durum ${res.status})`);
      return null;
    }
    const localName = fileNameFor(absUrl, res.contentType, this.usedNames);
    let buffer = res.buffer;
    // CSS ise ic referanslari yeniden yaz ve bagimli varliklari indir
    if (res.contentType.includes('css') || localName.endsWith('.css')) {
      const cssText = buffer.toString('utf8');
      const rewritten = await this.rewriteCss(cssText, res.finalUrl || absUrl);
      buffer = Buffer.from(rewritten, 'utf8');
    }
    const entry = { localName, buffer, contentType: res.contentType };
    this.map.set(absUrl, entry);
    this.log(`  + ${localName}`);
    return localName;
  }

  /** CSS icindeki url(...) ve @import referanslarini indirip yerel yola cevirir. */
  async rewriteCss(cssText, cssBaseUrl) {
    const refs = new Set();
    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
    const importRe = /@import\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = urlRe.exec(cssText))) refs.add(m[1]);
    while ((m = importRe.exec(cssText))) refs.add(m[1]);

    let out = cssText;
    for (const ref of refs) {
      const abs = resolveUrl(cssBaseUrl, ref);
      if (!abs) continue;
      const local = await this.add(abs);
      if (!local) continue;
      // CSS statik servis edilir; ayni klasordeki dosyaya goreli referans ver
      out = out.split(ref).join(local);
    }
    return out;
  }

  entries() {
    return [...this.map.values()];
  }
}
