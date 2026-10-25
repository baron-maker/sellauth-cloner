// clone-local.js - _grabbed/*.html (gercek tarayicidan alinan) dosyalardan tema uretir.
// adservice puppeteer'i engelledigi icin HTML tarayicidan toplandi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetManager } from './src/assets.js';
import { transformPage, transformSecondary } from './src/transformer.js';
import { writeTheme } from './src/writer.js';
import { validateTheme } from './src/validate.js';
import { zipDir } from './src/zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAB = path.join(__dirname, '_grabbed');
const OUT_ROOT = path.join(__dirname, 'output');
const ORIGIN = 'https://adservice.mysellauth.com';

const SECONDARY = [
  { file: 'feedback.html', path: '/feedback', template: 'feedback' },
  { file: 'cart.html', path: '/cart', template: 'cart' },
];

async function main() {
  const homeHtml = fs.readFileSync(path.join(GRAB, 'home.html'), 'utf8');
  const assets = new AssetManager({ log: () => {} });
  const parts = await transformPage({ html: homeHtml, baseUrl: ORIGIN + '/', assets, log: (s) => console.log(s) });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(OUT_ROOT, `adservice-FULL-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const result = await writeTheme({ outDir, parts, assets, sourceUrl: ORIGIN });
  console.log(`> Ana sayfa yazildi. Dinamik urunler: ${result.productsInjected}`);

  // Ikincil sayfalar
  const settingsPath = path.join(outDir, 'settings.json');
  const schemaPath = path.join(outDir, 'schema.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  settings.templates = settings.templates || {};
  schema.components = schema.components || {};

  for (const s of SECONDARY) {
    const fp = path.join(GRAB, s.file);
    if (!fs.existsSync(fp)) continue;
    const html = fs.readFileSync(fp, 'utf8');
    const { mainHtml } = transformSecondary({ html, baseUrl: ORIGIN + s.path, injectProducts: false });
    if (!mainHtml || mainHtml.trim().length < 30) {
      console.log(`  - ${s.path}: bos, atlandi`);
      continue;
    }
    const comp = `cloned-${s.template}`;
    fs.writeFileSync(
      path.join(outDir, 'components', `${comp}.njk`),
      `<div class="component cloned-content" data-component-id="{{ componentId }}">\n${mainHtml}\n</div>\n`,
      'utf8'
    );
    settings.templates[s.template] = {
      layout: 'master',
      components: { [comp]: { type: comp, properties: {} } },
      components_order: [comp],
    };
    schema.components[comp] = { label: `Cloned ${s.template}`, properties: {} };
    console.log(`  + ${s.path} -> templates/${s.template}`);
  }

  const json = JSON.stringify(settings, null, 4);
  fs.writeFileSync(settingsPath, json, 'utf8');
  fs.writeFileSync(path.join(outDir, 'settings.default.json'), json, 'utf8');
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 4), 'utf8');

  const val = validateTheme(outDir, ['layouts/master.njk', 'templates/shop.njk', 'components/cloned.njk', 'components/cloned-feedback.njk', 'components/cloned-cart.njk', 'snippets/meta-tags.njk']);
  console.log(`> Dogrulama: ${val.ok ? 'OK' : 'HATALAR'}`);
  for (const r of (val.results || []).filter((x) => !x.ok)) console.log(`  ! ${r.file}: ${r.error}`);

  const zipPath = outDir + '.zip';
  zipDir(outDir, zipPath);
  console.log(`> ZIP: ${zipPath}`);
}

main().catch((e) => {
  console.error('HATA:', e);
  process.exit(1);
});
