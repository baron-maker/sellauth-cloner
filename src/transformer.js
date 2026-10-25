// transformer.js - Indirilen HTML'i Sellauth tema dosyalarina donusturur.
import * as cheerio from 'cheerio';
import { resolveUrl } from './fetcher.js';
import { injectSellauthComponents } from './injector.js';

/**
 * Bir sayfayi klonlar: varliklari indirir, head/body'yi ayirir,
 * Sellauth master.njk + custom-page template + meta snippet uretir.
 *
 * @param {object} args
 * @param {string} args.html       Ham HTML
 * @param {string} args.baseUrl    Sayfanin son (yonlendirmelerden sonraki) URL'si
 * @param {AssetManager} args.assets
 * @param {(s:string)=>void} args.log
 * @returns {Promise<{master:string, template:string, metaSnippet:string, title:string}>}
 */
export async function transformPage({ html, baseUrl, assets, log = () => {} }) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const title = ($('title').first().text() || 'Cloned Site').trim();

  // 1) <base> etiketi varsa gercek base'i ondan al
  const baseHref = $('base[href]').attr('href');
  const effectiveBase = baseHref ? resolveUrl(baseUrl, baseHref) || baseUrl : baseUrl;
  let originHost = '';
  try {
    originHost = new URL(effectiveBase).host;
  } catch {}

  // 2) Varliklari INDIRME; sadece mutlak (orijin) URL'ye cevir.
  //    Boylece assets/ klasoru sadece base dosyalarini icerir.
  absolutizeAssets($, effectiveBase);

  // 3) Inline style ve <style> icindeki url()'leri mutlaklastir
  absolutizeCssUrls($, effectiveBase);

  // 4) IC BAGLANTILARI mevcut magazaya cevir (adservice'e yonlendirme yok)
  rewriteInternalLinks($, effectiveBase, originHost, log);

  // 5) head icindeki meta/link/title'lari topla -> meta-tags snippet
  const metaSnippet = buildMetaSnippet($);

  // 6) head icindeki stylesheet ve font linkleri (master head'e girecek)
  const headLinks = collectHeadLinks($);

  // 7) head icindeki <style> bloklari (klonun renk degiskenleri vb.) - master'a girecek
  const headStyles = collectHeadStyles($);

  // 8a) KAPSAMLI SANITIZASYON: Nunjucks'i bozabilecek her seyi temizle
  sanitizeForNunjucks($, log);

  // 8b) Urun gridini gercek Sellauth products bilesenine bagla (dinamik urunler)
  const injection = injectSellauthComponents($, log);

  // 9) TAM govdeyi koru (parcalama yok!) - klonun kendi yapisi/CSS'i bozulmasin
  let bodyInner = $('body').html() || '';
  bodyInner = sanitizeNunjucksOutput(bodyInner);
  const bodyClass = $('body').attr('class') || '';
  const htmlLang = $('html').attr('lang') || 'en';
  const master = buildMinimalMaster({ htmlLang, headLinks, headStyles });

  return { bodyInner, bodyClass, htmlLang, master, metaSnippet, title, headLinks, injection };
}

// Klonun head'indeki <style> bloklarini toplar (renk degiskenleri, ozel stiller)
function collectHeadStyles($) {
  const out = [];
  $('head style').each((_, el) => {
    const css = $(el).html() || '';
    if (css.trim()) out.push(`<style>${css}</style>`);
  });
  return out.join('\n    ');
}

// Minimal master: base temanin sarici yapisi (#app/flex-wrapper/header/footer) YOK.
// Klonun kendi yapisi templateContent icinde bozulmadan render edilir.
function buildMinimalMaster({ htmlLang, headLinks, headStyles }) {
  return `<!DOCTYPE html>
<html lang="${htmlLang}" data-bs-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    {% render_snippet "meta-tags.njk" %}

    {# Kutuphaneler (Sellauth bilesenleri icin) #}
    <link href="{{ 'bootstrap@5.3.8.min.css' | staticAsset }}" rel="stylesheet" />
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet" />
    <link href="{{ 'choices@10.2.0.min.css' | staticAsset }}" rel="stylesheet" />

    {# Klonlanan sitenin kendi stil/font linkleri ve style bloklari #}
    ${headLinks}
    ${headStyles}

    {# Sellauth tema renk degiskenleri (panelden degistirilebilir) #}
    <style id="theme-styles">
      :root {
        --cl-accent: {{ global.properties.theme_color if global.properties.theme_color else '#6571FF' }};
        --cl-accent-rgb: {{ (global.properties.theme_color if global.properties.theme_color else '#6571FF') | hex_to_rgb }};
      }
    </style>

    {# Klon yerlesim duzeltmeleri (yatay tasma) #}
    <link href="{{ 'custom.css' | assetUrl }}" rel="stylesheet" />
  </head>
  <body>
    {{ templateContent | safe }}

    <script>
      window.shopId = {{ shop.id | json }};
      window.apiBaseUrl = {{ '' | apiInternalUrl | json }};
      window.currencyRatesUsd = {{ currency_rates_usd | json }};
      window.currencySymbols = {{ currency_symbols | json }};
      window.defaultCurrency = {{ currency | json }};
      window.shopCustomer = {{ shop_customer | json }};
    </script>

    {% if isBuilder %}
      {% render_snippet "script-builder.njk" %}
    {% endif %}

    <script src="{{ 'js.cookie@3.0.8.min.js' | staticAsset }}"></script>
    <script src="{{ 'choices@10.2.0.min.js' | staticAsset }}"></script>
    <script src="{{ 'jquery@3.7.1.min.js' | staticAsset }}"></script>
    <script src="{{ 'bootstrap.bundle@5.3.8.min.js' | staticAsset }}"></script>
    <script src="{{ 'script.js' | assetUrl }}" crossorigin="anonymous"></script>
    <script src="{{ 'alpinejs@3.15.12.min.js' | staticAsset }}"></script>

    {% render_snippet "script-integrations.njk" %}
  </body>
</html>
`;
}

/**
 * Ikincil sayfalar (feedback, terms, product...) icin: sadece ANA ICERIGI cikarir.
 * Header/footer master'dan gelir; burada onlari atlar.
 * @returns {{mainHtml:string, title:string}}
 */
export function transformSecondary({ html, baseUrl, injectProducts = false, log = () => {} }) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const title = ($('title').first().text() || '').trim();
  const baseHref = $('base[href]').attr('href');
  const effectiveBase = baseHref ? resolveUrl(baseUrl, baseHref) || baseUrl : baseUrl;
  let originHost = '';
  try {
    originHost = new URL(effectiveBase).host;
  } catch {}

  absolutizeAssets($, effectiveBase);
  absolutizeCssUrls($, effectiveBase);
  rewriteInternalLinks($, effectiveBase, originHost, () => {});
  sanitizeForNunjucks($, () => {});
  if (injectProducts) injectSellauthComponents($, () => {});

  let mainHtml = $('body').html() || '';
  mainHtml = sanitizeNunjucksOutput(mainHtml);
  return { mainHtml, title };
}

// Klonu parcalara ayirir: announcement / navbar / footer / ana icerik
function decomposeClone($, log = () => {}) {
  const grab = (selectors, componentId) => {
    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length) {
        el.addClass('component');
        el.attr('data-component-id', componentId);
        const html = $.html(el);
        el.remove();
        return html;
      }
    }
    return null;
  };

  // Sira onemli: announcement once (navbar 'header' secicisi onu kapmasin)
  const announcementHtml = grab(['.sa-announcement', '.announcement', '#announcement', '[class*="announcement"]'], 'announcement');
  const navbarHtml = grab(['nav.sa-nav', 'header nav', 'nav.navbar', '.navbar', '#navbar', 'header nav', 'nav'], 'navbar');
  const footerHtml = grab(['footer', '.sa-footer', '.footer', '#footer', '[class*="footer"]'], 'footer');

  // Ana icerik: tercihen .components, yoksa #app ici, yoksa body
  let mainHtml = '';
  const comps = $('.components').first();
  if (comps.length) {
    mainHtml = comps.html() || '';
  } else {
    $('.bg-image').remove();
    const app = $('#app').first();
    mainHtml = (app.length ? app.html() : $('body').html()) || '';
  }

  const found = [announcementHtml && 'announcement', navbarHtml && 'navbar', footerHtml && 'footer'].filter(Boolean);
  log(`  Ayiklanan global bilesenler: ${found.length ? found.join(', ') : '(yok)'}`);

  return { announcementHtml, navbarHtml, footerHtml, mainHtml };
}

// --- yardimcilar ---

// Sadece gercek varlik iceren link rel'leri yerelize edilir
const ASSET_LINK_RELS = ['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'mask-icon', 'preload', 'prefetch', 'manifest'];

const URL_ATTRS = [
  ['script[src]', 'src'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['embed[src]', 'src'],
  ['object[data]', 'data'],
];

// Varlik URL'lerini mutlak (orijin) hale getirir; INDIRMEZ.
function absolutizeAssets($, base) {
  // link[href] (stylesheet/icon/font vb.)
  $('link[href]').each((_, el) => {
    const $el = $(el);
    const rel = ($el.attr('rel') || '').toLowerCase().trim();
    if (!ASSET_LINK_RELS.some((r) => rel.split(/\s+/).includes(r))) return;
    const abs = resolveUrl(base, $el.attr('href'));
    if (abs) $el.attr('href', abs);
  });
  for (const [selector, attr] of URL_ATTRS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const abs = resolveUrl(base, $el.attr(attr));
      if (abs) $el.attr(attr, abs);
    });
  }
  // srcset
  $('img[srcset], source[srcset]').each((_, el) => {
    const $el = $(el);
    const val = $el.attr('srcset') || '';
    const rebuilt = val
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((part) => {
        const [u, ...desc] = part.split(/\s+/);
        const abs = resolveUrl(base, u);
        return abs ? `${abs} ${desc.join(' ')}`.trim() : part;
      });
    $el.attr('srcset', rebuilt.join(', '));
  });
}

// Inline style ve <style> icindeki url()'leri mutlaklastir
function absolutizeCssUrls($, base) {
  const fix = (css) => {
    if (!css || !css.includes('url(')) return css;
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
      const abs = resolveUrl(base, ref);
      return abs ? `url(${q}${abs}${q})` : m;
    });
  };
  $('[style]').each((_, el) => {
    const $el = $(el);
    $el.attr('style', fix($el.attr('style') || ''));
  });
  $('style').each((_, el) => {
    const $el = $(el);
    $el.text(fix($el.html() || ''));
  });
}

// IC baglantilari mevcut Sellauth magazasina cevirir.
// Ayni orijine giden linkler -> {{ '/yol' | shopUrl }} (adservice'e gitmez).
// Farkli domain -> mutlak (disa link olarak kalir).
function rewriteInternalLinks($, base, originHost, log) {
  let internal = 0;
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const raw = ($el.attr('href') || '').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) return;
    const abs = resolveUrl(base, raw);
    if (!abs) return;
    let u;
    try {
      u = new URL(abs);
    } catch {
      return;
    }
    if (originHost && u.host === originHost) {
      // Ayni site: yalnizca yol + sorgu + capa, magazaya goreli
      const rel = (u.pathname || '/') + (u.search || '') + (u.hash || '');
      $el.attr('href', `{{ '${rel}' | shopUrl }}`);
      internal++;
    } else {
      // Disa link: mutlak birak, yeni sekmede ac
      $el.attr('href', abs);
    }
  });
  // form action'lari da ayni siteye cevir
  $('form[action]').each((_, el) => {
    const $el = $(el);
    const abs = resolveUrl(base, $el.attr('action'));
    if (!abs) return;
    try {
      const u = new URL(abs);
      if (originHost && u.host === originHost) {
        $el.attr('action', `{{ '${(u.pathname || '/') + (u.search || '')}' | shopUrl }}`);
      }
    } catch {}
  });
  log(`  ${internal} ic baglanti magazaya (shopUrl) cevrildi`);
}

function buildMetaSnippet($) {
  const keep = [];
  $('head meta').each((_, el) => {
    const $el = $(el);
    // charset ve viewport master'da zaten var, atla
    if ($el.attr('charset')) return;
    const name = ($el.attr('name') || '').toLowerCase();
    if (name === 'viewport') return;
    keep.push($.html(el).trim());
  });
  const title = $('title').first().text().trim();
  const canonical = $('head link[rel="canonical"]').toArray().map((el) => $.html(el).trim());
  return [
    `<title>${escapeHtml(title)}</title>`,
    ...keep,
    ...canonical,
  ].join('\n');
}

function collectHeadLinks($) {
  const links = [];
  $('head link').each((_, el) => {
    const rel = ($(el).attr('rel') || '').toLowerCase();
    if (rel.includes('canonical')) return; // meta snippet'e gitti
    if (rel.includes('icon') || rel.includes('stylesheet') || rel.includes('preconnect') || rel.includes('preload') || rel.includes('dns-prefetch') || rel.includes('manifest')) {
      links.push($.html(el).trim());
    }
  });
  return links.join('\n    ');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- KAPSAMLI NUNJUCKS SANITIZASYONU ---

// DOM seviyesinde temizlik: 3. parti scriptler, }} iceren attribute'ler, analytics
function sanitizeForNunjucks($, log = () => {}) {
  // 1) Analytics ve tracking scriptleri (}} iceren JSON attribute'leriyle birlikte)
  const scriptPatterns = [
    'script[data-cf-beacon]',
    'script[src*="cloudflareinsights"]',
    'script[src*="beacon.min.js"]',
    'script[src*="rocket-loader"]',
    'script[src*="google-analytics"]',
    'script[src*="googletagmanager"]',
    'script[src*="gtag"]',
    'script[src*="fbevents"]',
    'script[src*="facebook"]',
    'script[src*="hotjar"]',
    'script[src*="clarity.ms"]',
    'script[src*="segment"]',
    'script[src*="mixpanel"]',
    'script[src*="intercom"]',
    'script[src*="crisp"]',
    'script[src*="tawk"]',
    'script[src*="livechat"]',
    'script[src*="zendesk"]',
    'script[src*="sentry"]',
    'script[src*="newrelic"]',
    'script[src*="datadog"]',
    'noscript',
  ];
  let removedScripts = 0;
  for (const sel of scriptPatterns) {
    const els = $(sel);
    removedScripts += els.length;
    els.remove();
  }

  // 2) Inline script bloklari icinde analytics kodu
  $('script:not([src])').each((_, el) => {
    const code = ($(el).html() || '').toLowerCase();
    if (/gtag|ga\s*\(|fbq\s*\(|_paq|hotjar|clarity|analytics|dataLayer/i.test(code)) {
      $(el).remove();
      removedScripts++;
    }
  });

  if (removedScripts > 0) log(`  * ${removedScripts} analytics/tracking scripti temizlendi`);

  // 3) }} veya %} iceren data-* attribute'leri Nunjucks'i kirar -> temizle
  $('*').each((_, el) => {
    const $el = $(el);
    const attrs = el.attribs || {};
    for (const [key, val] of Object.entries(attrs)) {
      if (!key.startsWith('data-') || key === 'data-cloned-region' || key === 'data-component-id') continue;
      if (/\}\}|%\}/.test(val)) {
        $el.removeAttr(key);
      }
    }
  });

  // 4) Cloudflare Rocket Loader mangled type attribute'lerini duzelt
  $('script[type]').each((_, el) => {
    const $el = $(el);
    const type = $el.attr('type') || '';
    if (/^[a-f0-9]{20,}-/.test(type)) {
      const realType = type.replace(/^[a-f0-9]+-/, '');
      if (realType === 'module' || realType === 'text/javascript') {
        $el.attr('type', realType);
      } else {
        $el.removeAttr('type');
      }
    }
  });

  // 5) SellAuth loading screen kalinitisi (headless render sonrasi kalabilir)
  $('.sa-loading-screen, #sa-loading-screen, [data-loading-screen]').remove();
}

// String seviyesinde temizlik: Cheerio ciktisindaki entity sorunlari
function sanitizeNunjucksOutput(html) {
  // 1) Nunjucks {% %} ve {{ }} icindeki HTML entity'lerini geri al
  html = html.replace(/(\{[%{][\s\S]*?[%}]\})/g, (m) =>
    m.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  );

  // 2) Kalan tehlikeli }} patterlerini tespit et ve kacis karakteri ekle
  //    (Nunjucks taglari disinda kalan, attribute'lerdeki JSON }} gibi)
  const opens = (html.match(/\{\{/g) || []).length;
  const closes = (html.match(/\}\}/g) || []).length;
  if (closes > opens) {
    // Nunjucks expression'lari disindaki }} -> } } (boslukla ayir)
    html = fixUnmatchedCloseBraces(html);
  }

  return html;
}

// Nunjucks {{ }} ifadeleri disinda kalan }} kaliplarini } } olarak ayirir
function fixUnmatchedCloseBraces(html) {
  const result = [];
  let i = 0;
  let inExpr = false;
  while (i < html.length) {
    if (!inExpr && html[i] === '{' && html[i + 1] === '{') {
      inExpr = true;
      result.push('{{');
      i += 2;
    } else if (inExpr && html[i] === '}' && html[i + 1] === '}') {
      inExpr = false;
      result.push('}}');
      i += 2;
    } else if (!inExpr && html[i] === '}' && html[i + 1] === '}') {
      result.push('} }');
      i += 2;
    } else {
      result.push(html[i]);
      i++;
    }
  }
  return result.join('');
}
