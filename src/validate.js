// validate.js - Uretilen .njk dosyalarini Sellauth filtre/taglarini stub'layarak
// derler; sozdizimi hatasi varsa raporlar. nunjucks yoksa sessizce atlar.
import fs from 'node:fs';
import path from 'node:path';

let nunjucks = null;
try {
  nunjucks = (await import('nunjucks')).default;
} catch {
  nunjucks = null;
}

const FILTERS = ['assetUrl', 'staticAsset', 'hex_to_rgb', 'shopUrl', 'apiInternalUrl', 'renderString', 'json', 'formatDate', 'formatPrice'];
const TAGS = ['render_component', 'render_snippet'];

const GLOBALS = ['formatPrice', 'formatDate', 'range'];

function makeEnv() {
  const env = new nunjucks.Environment(null, { autoescape: false });
  FILTERS.forEach((f) => env.addFilter(f, (x) => x));
  GLOBALS.forEach((g) => env.addGlobal(g, (...args) => args[0]));
  for (const name of TAGS) {
    const ext = {
      tags: [name],
      parse(parser, nodes) {
        const tok = parser.nextToken();
        const args = parser.parseSignature(null, true);
        parser.advanceAfterBlockEnd(tok.value);
        return new nodes.CallExtension(ext, 'run', args);
      },
      run() {
        return '';
      },
    };
    env.addExtension(name, ext);
  }
  return env;
}

/**
 * @returns {{ok:boolean, results:{file:string, ok:boolean, error?:string}[]}}
 */
export function validateTheme(outDir, files = ['layouts/master.njk', 'templates/shop.njk', 'snippets/meta-tags.njk']) {
  if (!nunjucks) return { ok: true, skipped: true, results: [] };
  const env = makeEnv();
  const results = [];
  for (const rel of files) {
    const p = path.join(outDir, rel);
    try {
      nunjucks.compile(fs.readFileSync(p, 'utf8'), env);
      results.push({ file: rel, ok: true });
    } catch (e) {
      results.push({ file: rel, ok: false, error: String(e.message).split('\n')[0] });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
