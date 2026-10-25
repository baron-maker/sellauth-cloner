#!/usr/bin/env node
// index.js - Sellauth Cloner konsolu.
// Kullanici bir URL girer; arac siteyi indirip Sellauth temasina cevirir.
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchText } from './fetcher.js';
import { AssetManager } from './assets.js';
import * as cheerio from 'cheerio';
import { transformPage, transformSecondary } from './transformer.js';
import { writeTheme } from './writer.js';
import { renderPage, hasRenderer } from './renderer.js';
import { validateTheme } from './validate.js';
import { zipDir } from './zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '..', 'output');

function slugify(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-');
  } catch {
    return 'site';
  }
}

function normalizeUrl(input) {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

export async function cloneUrl(rawUrl, { log = console.log } = {}) {
  const url = normalizeUrl(rawUrl);
  log(`\n> Indiriliyor: ${url}`);

  // Once headless render dene (JS ile yuklenen icerik icin), olmazsa statik fetch
  let html, finalUrl;
  if (hasRenderer()) {
    log('> Headless tarayici ile render ediliyor (JS iceriik dahil)...');
    const r = await renderPage(url, { log });
    if (r && r.html) {
      html = r.html;
      finalUrl = r.finalUrl;
      log(`> Render tamam (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB).`);
    }
  }
  if (!html) {
    const page = await fetchText(url);
    if (!page.ok) throw new Error(`Sayfa indirilemedi (durum ${page.status}).`);
    html = page.text;
    finalUrl = page.finalUrl;
    log(`> Statik HTML alindi (${(page.buffer.length / 1024).toFixed(1)} KB).`);
  }

  log('> Donusturuluyor (varliklar orijinden yuklenecek, indirilmiyor)...');
  const assets = new AssetManager({ log });
  const parts = await transformPage({
    html,
    baseUrl: finalUrl,
    assets,
    log,
  });

  const slug = slugify(url);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(OUT_ROOT, `${slug}-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const result = await writeTheme({ outDir, parts, assets, sourceUrl: url });
  log(`\n> Tema yazildi: ${outDir}`);
  log(`  Sayfa basligi: "${parts.title}"`);
  log(`  Klon bileseni: components/${result.component}.njk (shop -> components_order)`);
  log(`  assets/ sadece base dosyalari icerir (klon varliklari orijinden yuklenir)`);
  log(`  Dinamik urunler: ${result.productsInjected ? 'EVET (render_component "products" enjekte edildi)' : 'hayir (urun gridi bulunamadi)'}`);

  // Cok-sayfali klonlama: ayni domaindeki TUM ic linkleri kesfet ve klonla
  try {
    const origin = new URL(finalUrl).origin;
    const paths = discoverInternalPaths(html, finalUrl);
    log(`> ${paths.length} ic link kesfedildi: ${paths.join(', ')}`);
    await cloneSecondaryPages(outDir, origin, paths, log);
  } catch (e) {
    log(`  ! ikincil sayfa klonlama atlandi: ${e.message}`);
  }

  // Sozdizimi dogrulamasi
  const filesToValidate = [
    'layouts/master.njk',
    'templates/shop.njk',
    'templates/product.njk',
    'templates/products.njk',
    'components/cloned.njk',
    'components/product-page.njk',
    'components/products.njk',
    'components/products-page.njk',
    'snippets/product-card.njk',
    'snippets/product-card-horizontal.njk',
    'snippets/product-form.njk',
    'snippets/meta-tags.njk',
  ];
  try {
    const componentFiles = await fs.readdir(path.join(outDir, 'components'));
    for (const file of componentFiles) {
      if (/^cloned-.*\.njk$/.test(file)) filesToValidate.push(`components/${file}`);
    }
  } catch {}
  if (result.feedbacksInjected) filesToValidate.push('components/feedbacks.njk');
  const val = validateTheme(outDir, filesToValidate);
  if (val.skipped) {
    log('  (dogrulama atlandi: nunjucks yok)');
  } else if (val.ok) {
    log('  Dogrulama: tum sablonlar hatasiz derlendi.');
  } else {
    for (const r of val.results.filter((x) => !x.ok)) log(`  ! Sablon hatasi ${r.file}: ${r.error}`);
  }

  // Sellauth formatinda ILERI BOLU'lu zip (kendi yazicimiz)
  const zipPath = outDir + '.zip';
  zipDir(outDir, zipPath);
  log(`> ZIP hazir (Sellauth formati, / ayirac): ${zipPath}`);

  return { outDir, zipPath, ...result };
}

// Ana sayfadaki AYNI DOMAIN'e ait tum ic link path'lerini kesfeder
function discoverInternalPaths(html, baseUrl) {
  const $ = cheerio.load(html);
  let host;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return [];
  }
  const paths = new Set();
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    let u;
    try {
      u = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (u.host !== host) return; // sadece ayni domain
    let p = u.pathname.replace(/\/+$/, '') || '/';
    if (p === '/' || p === '') return; // ana sayfa zaten klonlandi
    paths.add(p);
  });
  if ($('a[href*="/product/"]').length > 0) {
    paths.add('/products');
  }
  return [...paths];
}

// Bir path'i Sellauth template'ine esler (bilinmeyen -> custom-page)
function pathToTemplate(p) {
  const s = p.toLowerCase();
  if (s.startsWith('/product/')) return 'product';
  if (s.startsWith('/products')) return 'products';
  if (s.startsWith('/cart')) return 'cart';
  if (s.startsWith('/feedback')) return 'feedback';
  if (s.startsWith('/customer') || s.startsWith('/profile') || s.startsWith('/account')) return 'customer-dashboard';
  if (s.includes('terms')) return 'terms';
  if (s.includes('privacy')) return 'privacy-policy';
  if (s.includes('refund')) return 'refund-policy';
  if (s.includes('faq')) return 'faq';
  if (s.includes('status')) return 'status';
  if (s.startsWith('/blog')) return 'blog';
  return 'custom-page';
}

// Kesfedilen tum sayfalari klonlayip ilgili template'lere yerlestirir
async function cloneSecondaryPages(outDir, origin, paths, log = () => {}) {
  log('> Ikincil sayfalar klonlaniyor (ayni domain, tum linkler)...');
  const settingsPath = path.join(outDir, 'settings.json');
  const settingsDefPath = path.join(outDir, 'settings.default.json');
  const schemaPath = path.join(outDir, 'schema.json');
  let settings, schema;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  } catch {
    return;
  }
  settings.templates = settings.templates || {};
  schema.components = schema.components || {};

  const doneTemplates = new Set(); // her template icin ilk sayfa yeter
  for (const p of paths) {
    const template = pathToTemplate(p);
    if (doneTemplates.has(template)) continue; // ayni template'i tekrar klonlama

    // Tek urun sayfasi: statik klonlama YOK. Base'in dinamik product-page bileseni
    // kullanilir -> gercek urun basligi/fiyati/aciklamasi + tek buy/cart butonu.
    if (template === 'product') {
      doneTemplates.add('product');
      log(`  = ${p} -> templates/product (dinamik product-page bileseni, statik klonlanmadi)`);
      continue;
    }

    const pageUrl = origin + p;
    const isProduct = template === 'product' || template === 'products';
    let html = null;
    if (hasRenderer()) {
      const r = await renderPage(pageUrl, { log: () => {}, timeout: 25000 });
      if (r && r.html) html = r.html;
    }
    if (!html) {
      const t = await fetchText(pageUrl);
      if (t.ok) html = t.text;
    }
    if (!html) {
      log(`  - ${p}: alinamadi, atlandi`);
      continue;
    }
    const { mainHtml } = transformSecondary({ html, baseUrl: pageUrl, injectProducts: isProduct });
    if (!mainHtml || mainHtml.trim().length < 30) {
      log(`  - ${p}: bos icerik, atlandi`);
      continue;
    }
    const compName = `cloned-${template}`;
    const njk = `<div style="display:contents" data-component-id="{{ componentId }}">\n${mainHtml}\n</div>\n`;
    await fs.writeFile(path.join(outDir, 'components', `${compName}.njk`), njk, 'utf8');
    settings.templates[template] = {
      layout: 'master',
      components: { [compName]: { type: compName, properties: {} } },
      components_order: [compName],
    };
    schema.components[compName] = { label: `Cloned ${template}`, properties: {} };
    doneTemplates.add(template);
    log(`  + ${p} -> templates/${template} (${compName}.njk)`);
  }

  const json = JSON.stringify(settings, null, 4);
  await fs.writeFile(settingsPath, json, 'utf8');
  await fs.writeFile(settingsDefPath, json, 'utf8').catch(() => {});
  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 4), 'utf8');
}

async function main() {
  await fs.mkdir(OUT_ROOT, { recursive: true });

  // Argumanla verildiyse tek seferlik calis
  const argUrl = process.argv[2];
  if (argUrl) {
    try {
      await cloneUrl(argUrl);
    } catch (e) {
      console.error('HATA:', e.message);
      process.exit(1);
    }
    return;
  }

  console.log('=== Baron Sellauth Site Cloner ===');
  console.log('Bir URL gir, Enter\'a bas. Cikmak icin: exit\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () =>
    rl.question('URL> ', async (answer) => {
      const a = answer.trim();
      if (!a || a.toLowerCase() === 'exit' || a.toLowerCase() === 'q') {
        rl.close();
        return;
      }
      try {
        await cloneUrl(a);
      } catch (e) {
        console.error('HATA:', e.message);
      }
      console.log('');
      ask();
    });
  ask();
}

// Dogrudan calistirildiginda konsolu ac
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
