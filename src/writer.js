// writer.js - Sellauth base temasini kopyalar, klonu TEK bir kayitli bilesen
// (components/cloned.njk) olarak formatlar. shop.njk base'in components_order
// dongusu olarak kalir; master klonun head varliklariyla yamanir.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.resolve(__dirname, '..', 'sellauth-base');

const CLONE_COMPONENT = 'cloned';

const FEEDBACKS_COMPONENT = `{% set data = [] %}
{% if feedbacks %}{% set data = feedbacks %}{% elif latest_feedbacks %}{% set data = latest_feedbacks %}{% endif %}

<section id="feedbacks" class="component sa-feedbacks sa-feedbacks--grid py-section" data-component-id="{{ componentId }}">
  <div class="wrap">
    <div class="sa-section-header section-header max-w-2xl mb-10 mx-auto text-center">
      {% if properties.title %}
      <h2 class="sa-section-title text-h2 font-heading text-t-primary text-balance hl-underline">{{ properties.title | renderString | safe }}</h2>
      {% endif %}
      {% if properties.subtitle %}
      <p class="sa-section-subtitle text-t-muted mt-2">{{ properties.subtitle | renderString | safe }}</p>
      {% endif %}
    </div>

    <div class="sa-feedbacks-items grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-grid-gap">
      {% for feedback in data.slice(0, properties.amount if properties.amount else 8) %}
      <div class="sa-feedbacks-item">
        <div class="sa-feedback-card sa-feedback-card--classic flex flex-col h-full rounded-card border border-theme bg-surface shadow-card" x-data="feedbackCard">
          <div class="relative flex-1 p-4">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div class="flex items-center gap-2 min-w-0">
                <div class="flex shrink-0" aria-label="{{ feedback.rating }} out of 5 stars">
                  {% for i in range(0, feedback.rating) %}
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-[18px] h-[18px] text-warning" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  {% endfor %}
                  {% for i in range(0, 5 - feedback.rating) %}
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-[18px] h-[18px] text-t-muted/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  {% endfor %}
                </div>
                <span class="inline-flex items-center gap-1 text-xs font-medium text-success truncate" title="From a completed order">
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"></path><path d="m9 12 2 2 4-4"></path></svg>
                  Verified
                </span>
              </div>
              <span class="text-xs text-t-muted shrink-0">{{ feedback.created_at | formatDate }}</span>
            </div>

            <p class="text-sm text-t-primary break-words line-clamp-4" x-ref="msg" :class="{ 'line-clamp-4': !expanded }">{{ feedback.message }}</p>

            {% if feedback.reply %}
            <div class="mt-3 bg-t-primary/5 p-3 rounded-input">
              <p class="pl-2.5 text-sm text-t-muted border-l-2 border-accent-500 break-words line-clamp-4" x-ref="reply" :class="{ 'line-clamp-4': !expanded }">{{ feedback.reply }}</p>
              <p class="text-xs text-right text-t-muted mt-2">Reply from <span class="text-accent-500">{{ shop.name }}</span> &middot; {{ feedback.replied_at | formatDate }}</p>
            </div>
            {% endif %}

            <button type="button" x-show="clamped" :aria-expanded="expanded" @click="expanded = !expanded" class="mt-2 text-xs font-medium text-accent-500 hover:underline underline-offset-2" x-text="expanded ? 'Show less' : 'Read more'">Read more</button>
          </div>

          {% if feedback.items and feedback.items.length > 0 %}
          <div class="relative px-4 py-2.5 text-xs text-t-muted border-t border-theme">
            <div class="flex items-center gap-1.5">
              {% if feedback.items[0].image_url %}
              <img class="size-5 rounded" src="{{ feedback.items[0].image_url }}" alt="{{ feedback.items[0].name }}" loading="lazy">
              {% endif %}
              <p class="flex-1 truncate">{{ feedback.items[0].name }}{% if feedback.items.length > 1 %} &amp; {{ feedback.items.length - 1 }} more{% endif %}</p>
            </div>
          </div>
          {% endif %}
        </div>
      </div>
      {% endfor %}
    </div>
  </div>
</section>
`;

/**
 * @param {object} args
 * @param {string} args.outDir
 * @param {object} args.parts     transformPage sonucu (bodyInner, headLinks, metaSnippet, title)
 * @param {AssetManager} args.assets
 * @param {string} args.sourceUrl
 */
export async function writeTheme({ outDir, parts, assets, sourceUrl }) {
  // 1) Base tema (gercek Sellauth format + dinamik bilesenler)
  await copyDir(BASE_DIR, outDir);

  // 2) Klonlanan varliklar
  await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });
  for (const entry of assets.entries()) {
    await fs.writeFile(path.join(outDir, 'assets', entry.localName), entry.buffer);
  }

  // 2b) Klon yerlesim duzeltmeleri (yatay tasma vb.) custom.css'e eklenir
  const cssFix = `\n\n/* --- cloner layout fixes --- */\n` +
    `html, body { overflow-x: hidden !important; max-width: 100%; }\n` +
    `img, video, iframe { max-width: 100%; }\n` +
    `.fbq__track, .fbq__row, .fbq__marquee-wrap, [class*="marquee"], [class*="vouches-strip"] { max-width: 100vw; overflow: hidden; }\n`;
  const customCssPath = path.join(outDir, 'assets', 'custom.css');
  await fs.appendFile(customCssPath, cssFix, 'utf8').catch(async () => {
    await fs.writeFile(customCssPath, cssFix, 'utf8');
  });

  // 3) TAM klon govdesi -> cloned bileseni. display:contents sarici layout'u bozmaz.
  const componentNjk =
    `<div style="display:contents" data-component-id="{{ componentId }}">\n` +
    `${parts.bodyInner}\n` +
    `</div>\n`;
  await fs.writeFile(path.join(outDir, 'components', `${CLONE_COMPONENT}.njk`), componentNjk, 'utf8');

  // 4) meta-tags snippet'ini klondan yaz
  await fs.writeFile(path.join(outDir, 'snippets', 'meta-tags.njk'), parts.metaSnippet, 'utf8');

  // 5) Minimal master'i yaz (base'in sarici yapisi yok; klon yapisi korunur)
  await fs.writeFile(path.join(outDir, 'layouts', 'master.njk'), parts.master, 'utf8');

  // 6) Dinamik feedbacks bileseni (statik yorumlar yerine)
  const feedbacksInjected = !!parts.injection?.feedbacks;
  if (feedbacksInjected) {
    await fs.writeFile(path.join(outDir, 'components', 'feedbacks.njk'), FEEDBACKS_COMPONENT, 'utf8');
  }

  // 7) settings: shop template'i (cloned + gerekirse dinamik products/feedbacks)
  const productsInjected = !!parts.injection?.products;
  await patchSettings(outDir, productsInjected, feedbacksInjected);

  // 8) schema: "cloned" bilesenini tanimla
  await patchSchema(outDir);

  return { assetCount: assets.entries().length, component: CLONE_COMPONENT, productsInjected, feedbacksInjected };
}

async function patchMaster(outDir, headLinks) {
  const p = path.join(outDir, 'layouts', 'master.njk');
  let m = await fs.readFile(p, 'utf8');
  // Klon head varliklarini </head> oncesine enjekte et
  if (headLinks && headLinks.trim()) {
    m = m.replace('</head>', `    {# Klonlanan sitenin stil/font linkleri #}\n    ${headLinks}\n  </head>`);
  }
  // navbar/announcement/footer render'lari KORUNUR -> klon header/footer her sayfada
  await fs.writeFile(p, m, 'utf8');
}

async function patchSettings(outDir, productsInjected, feedbacksInjected) {
  for (const file of ['settings.json', 'settings.default.json']) {
    const p = path.join(outDir, file);
    let s;
    try {
      s = JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {
      continue;
    }
    s.templates = s.templates || {};
    const components = {
      [CLONE_COMPONENT]: { type: CLONE_COMPONENT, properties: {} },
    };
    if (productsInjected) {
      components.products = { type: 'products', properties: { title: null, subtitle: null } };
    }
    if (feedbacksInjected) {
      components.feedbacks = { type: 'feedbacks', properties: { title: 'What customers <span class="mk">say</span>', subtitle: null, amount: 8 } };
    }
    s.templates.shop = {
      layout: 'master',
      components,
      components_order: [CLONE_COMPONENT],
    };
    await fs.writeFile(p, JSON.stringify(s, null, 4), 'utf8');
  }
}

async function patchSchema(outDir) {
  const p = path.join(outDir, 'schema.json');
  let s;
  try {
    s = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return;
  }
  s.components = s.components || {};
  s.components[CLONE_COMPONENT] = {
    label: 'Cloned Content',
    properties: {},
  };
  if (!s.components.feedbacks) {
    s.components.feedbacks = {
      label: 'Feedbacks',
      multiple: true,
      properties: {
        title: { label: 'Title', type: 'text', default: 'What customers say' },
        subtitle: { label: 'Subtitle', type: 'text', default: null },
        amount: { label: 'Amount', type: 'number', default: 8 },
      },
    };
  }
  await fs.writeFile(p, JSON.stringify(s, null, 4), 'utf8');
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}
