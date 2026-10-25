// injector.js - Klondaki urun gridini, KLONUN kendi kart tasarimini koruyarak
// magazanin gercek urunleriyle dinamiklestirir (Nunjucks dongusu).

const PRICE_TEXT_RE = /[€$£₺¥₹]\s*[\d.,]+|\d+[.,]\d{2}\s*[€$£₺¥₹]|\d+\s*(?:USD|EUR|GBP|TRY)/i;
const PRODUCTS_TAG = '{% render_component "products" %}';
const STOCK_TEXT_RE = /^(in\s*stock|out\s*of\s*stock|\d+\s*in\s*stock|stokta|stok\s*yok|available|unavailable|sold\s*out)$/i;

const STOCK_DYN = [
  '{% if item.stock > 0 %}',
  '<span class="text-success">In stock</span>',
  '{% else %}',
  '<span class="text-error">Out of stock</span>',
  '{% endif %}',
].join('');

/**
 * @param {CheerioAPI} $
 * @param {(s:string)=>void} log
 */
export function injectSellauthComponents($, log = () => {}) {
  let productsResult = { products: false, mode: 'none', count: 0 };

  const cards = $('a[href*="/product/"]').toArray().filter((a) => $(a).find('img').length > 0);
  if (cards.length >= 1) {
    const ok = templatizeProductGrid($, cards, log);
    if (ok) productsResult = { products: true, mode: 'cards', count: cards.length };
  }

  if (!productsResult.products) {
    const containers = findProductContainers($);
    if (containers.length) {
      containers.forEach((el, i) => {
        const $el = $(el);
        if (i === 0) {
          $el.empty();
          $el.append(`\n${PRODUCTS_TAG}\n`);
          $el.removeAttr('data-component-id');
          $el.attr('data-cloned-region', 'products');
        } else {
          $el.remove();
        }
      });
      log(`  * ${containers.length} urun bolumu -> render_component products`);
      productsResult = { products: true, mode: 'sections', count: containers.length };
    }
  }

  if (!productsResult.products && $('a[href*="#products"]').length > 0 && $('#products').length === 0) {
    const section = `\n<section id="products" data-cloned-region="products">\n  ${PRODUCTS_TAG}\n</section>\n`;
    const anchor = pickInsertionPoint($);
    if (anchor) {
      $(anchor).after(section);
      productsResult = { products: true, mode: 'inserted', count: 1 };
    }
  }

  const feedbacksInjected = replaceFeedbackSection($, log);
  return { ...productsResult, feedbacks: feedbacksInjected };
}

// --- URUN ADI TESPITI ---

function detectProductName($, $card) {
  // 1) img alt
  const alt = ($card.find('img').first().attr('alt') || '').trim();
  if (alt && alt.length > 1 && alt.length < 200) return alt;

  // 2) heading (h1-h6)
  const heading = $card.find('h1, h2, h3, h4, h5, h6').first();
  if (heading.length) {
    const t = heading.text().trim();
    if (t && t.length > 1) return t;
  }

  // 3) data-title attribute
  const title = ($card.attr('data-title') || '').trim();
  if (title) return title;

  // 4) bilinen siniflar
  const titleSels = '.sa-product-card-title, .product-title, .product-name, .card-title, [class*="title"]';
  const titleEl = $card.find(titleSels).first();
  if (titleEl.length) {
    const t = titleEl.text().trim();
    if (t && t.length > 1) return t;
  }

  // 5) URL'den slug -> isim tahmini
  const href = ($card.attr('href') || '');
  const slugMatch = href.match(/\/product\/([^/?#]+)/);
  if (slugMatch) {
    return decodeURIComponent(slugMatch[1]).replace(/-/g, ' ');
  }

  return '';
}

// --- STATIK KART ARAMA ---

function findStaticProductCards($) {
  return $('a[href*="/product/"]').toArray().filter((a) => {
    const $a = $(a);
    if ($a.find('img').length === 0) return false;
    if ($a.closest('[data-cloned-region]').length > 0) return false;
    return true;
  });
}

// --- GRID CONTAINER TESPITI ---

function resolveGrid($, $card, totalCards) {
  const directParent = $card.parent();
  if (!directParent || !directParent.length) return null;

  // Kart wrapper icindeyse (sa-products-item, col-*, tek cocuklu div)
  // gercek grid = grandparent
  const cardsInParent = directParent.find('> a[href*="/product/"]').length;
  if (cardsInParent <= 1 && totalCards > 1) {
    const gp = directParent.parent();
    if (gp.length) return gp;
  }
  return directParent;
}

// --- KART SABLONU OLUSTURMA ---

function buildCardTemplate($, $card) {
  const name = detectProductName($, $card);
  const $tpl = $card.clone();

  // Link -> dinamik urun yolu
  $tpl.attr('href', "{{ ('/product/' + item.path) | shopUrl }}");

  // data-* attribute'lerindeki urun verilerini temizle
  for (const attr of ['data-title', 'data-name', 'data-product']) {
    if ($tpl.attr(attr)) $tpl.attr(attr, '{{ item.name }}');
  }
  for (const attr of ['data-price', 'data-amount']) {
    if ($tpl.attr(attr)) $tpl.attr(attr, '{{ item.min_price }}');
  }
  if ($tpl.attr('data-id')) $tpl.removeAttr('data-id');
  // data-bs-toggle/target modaller icin -> sil (statik modal verisi)
  $tpl.removeAttr('data-bs-toggle').removeAttr('data-bs-target');

  // TUM gorseller -> dinamik
  $tpl.find('img').each((_, el) => {
    const $img = $(el);
    $img.attr('src', '{{ item.image_url }}');
    $img.attr('alt', '{{ item.name }}');
    $img.removeAttr('srcset');
    $img.removeAttr('data-src');
    $img.removeAttr('data-srcset');
  });

  // ISIM: once metin eslestirme, sonra bilinen siniflar, sonra heading fallback
  if (name) {
    $tpl.find('*').each((_, el) => {
      const $el = $(el);
      if ($el.children().length === 0 && $el.text().trim() === name) {
        $el.text('{{ item.name }}');
      }
    });
  }
  const titleSels = '.sa-product-card-title, .product-title, .product-name, .card-title';
  $tpl.find(titleSels).each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() !== '{{ item.name }}') $el.text('{{ item.name }}');
  });
  $tpl.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const $el = $(el);
    const t = $el.text().trim();
    if (t && t !== '{{ item.name }}' && !PRICE_TEXT_RE.test(t)) {
      $el.text('{{ item.name }}');
    }
  });

  // FIYAT: ilk = min_price, ikinci = max_price
  let priceIdx = 0;
  $tpl.find('*').each((_, el) => {
    const $el = $(el);
    if ($el.children().length === 0 && PRICE_TEXT_RE.test($el.text().trim())) {
      const field = priceIdx === 0 ? 'min_price' : 'max_price';
      $el.attr('x-text', `appCurrency.format({{ item.${field} }}, '{{ item.currency }}')`);
      $el.text(`{{ formatPrice(item.${field}, item.currency) }}`);
      priceIdx++;
    }
  });

  // STOK: once sinif bazli, sonra tum metin bazli (ikisini de yap)
  const stockSels = '.sa-product-card-stock, .stock, .product-stock, [class*="stock"]';
  $tpl.find(stockSels).each((_, el) => {
    $(el).html(STOCK_DYN);
  });
  $tpl.find('*').each((_, el) => {
    const $el = $(el);
    if ($el.children().length === 0 && STOCK_TEXT_RE.test($el.text().trim())) {
      $el.html(STOCK_DYN);
    }
  });

  let html = $.html($tpl);
  html = unescapeNunjucks(html);
  return html;
}

// --- COKLU GRID TEMPLATIZASYONU ---

function templatizeProductGrid($, _initialCards, log) {
  let totalCount = 0;

  for (let pass = 0; pass < 10; pass++) {
    const cards = findStaticProductCards($);
    if (cards.length < 1) break;

    const $first = $(cards[0]);
    const grid = resolveGrid($, $first, cards.length);
    if (!grid || !grid.length) break;

    const tplHtml = buildCardTemplate($, $first);
    const loop =
      `{% for item in sortedItems %}{% if item.type == 'group' or not item.group_id %}\n` +
      `${tplHtml}\n` +
      `{% endif %}{% endfor %}`;

    const countInGrid = grid.find('a[href*="/product/"]').length || cards.length;
    grid.empty();
    grid.append(loop);
    if (!grid.attr('id') && pass === 0) grid.attr('id', 'products');
    grid.attr('data-cloned-region', 'products');

    totalCount += countInGrid;
    log(`  * Gecis ${pass + 1}: ${countInGrid} urun karti dinamiklestirildi`);
  }

  // Grup modallari: statik urun verisi, sil
  const removed = $('.sa-group-modal').length;
  $('.sa-group-modal').remove();
  if (removed) log(`  * ${removed} statik grup modali silindi`);

  if (totalCount > 0) log(`  * Toplam ${totalCount} urun karti sortedItems dongusuyle degistirildi`);
  return totalCount > 0;
}

// --- NUNJUCKS ENTITY DECODE ---
// Cheerio, Nunjucks taglari icindeki > < & karakterlerini HTML entity'ye cevirir.
// Bu Nunjucks'i kirar -> geri al.
function unescapeNunjucks(html) {
  return html.replace(/(\{[%{][\s\S]*?[%}]\})/g, (m) =>
    m.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  );
}

// --- YARDIMCILAR ---

function findProductContainers($) {
  const out = [];
  $('section, div, ol, ul').each((_, el) => {
    const $el = $(el);
    const cls = ($el.attr('class') || '').toLowerCase();
    if (!/\bsa-products\b|\bproducts\b|\bproduct-list\b|\bproduct-grid\b|\bproducts-grid\b/.test(cls)) return;
    const html = $el.html() || '';
    if (!/product-card|sa-product-card|\$[0-9]|€[0-9]|£[0-9]|[0-9][.,][0-9]{2}/i.test(html)) return;
    if (out.some((o) => containsNode(o, el))) return;
    out.push(el);
  });
  return out;
}

function containsNode(ancestor, node) {
  let p = node.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function pickInsertionPoint($) {
  const candidates = ['#hero', 'section.hero', '.sa-hero', '#navbar', 'header', 'nav'];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) return el.get(0);
  }
  const first = $('body > *')
    .filter((_, e) => ['section', 'div', 'main'].includes((e.tagName || '').toLowerCase()))
    .first();
  return first.length ? first.get(0) : null;
}

function replaceFeedbackSection($, log) {
  const section = $('section.sa-feedbacks, section#feedbacks, [data-component-id="feedbacks"]').first();
  if (!section.length) return false;
  section.replaceWith('\n{% render_component "feedbacks" %}\n');
  log('  * Statik geri bildirimler -> dinamik feedbacks bileseni');
  return true;
}
