// renderer.js - Headless Chromium ile sayfayi gercekten render eder.
// JS ile yuklenen icerikleri, lazy gorselleri ve son DOM'u yakalar.
// Puppeteer yoksa null doner (cagiran taraf statik fetch'e duser).

let puppeteer = null;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  puppeteer = null;
}

export const hasRenderer = () => !!puppeteer;

/**
 * Sayfayi render edip son HTML'i ve aginda gorulen varlik URL'lerini doner.
 * @returns {Promise<{html:string, finalUrl:string, assetUrls:string[]} | null>}
 */
export async function renderPage(url, { log = () => {}, timeout = 45000 } = {}) {
  if (!puppeteer) return null;
  let browser;
  const assetUrls = new Set();
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
    );

    // Ag isteklerini topla (arka planda yuklenen varliklari yakalamak icin)
    page.on('response', (res) => {
      const u = res.url();
      const type = res.request().resourceType();
      if (['image', 'stylesheet', 'font', 'script', 'media'].includes(type)) {
        assetUrls.add(u);
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    // SellAuth/SPA yukleme ekranini ("Please wait... <3") gec: gercek icerik gelene kadar bekle
    await page
      .waitForFunction(
        () =>
          document.title !== 'Please wait... <3' &&
          !!document.querySelector('.components, #app .flex-wrapper, section, main, [data-component-id]'),
        { timeout: 25000, polling: 500 }
      )
      .catch(() => {});
    await sleep(1200);

    // Lazy-load'u tetiklemek icin sayfayi bastan sona kaydir
    await autoScroll(page);
    await sleep(1000);

    const finalUrl = page.url();
    const html = await page.content();
    return { html, finalUrl, assetUrls: [...assetUrls] };
  } catch (e) {
    log(`  ! render hatasi: ${e.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight + 1000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
