// fetcher.js - URL'den HTML ve tum varliklari (asset) indirir
import { URL } from 'node:url';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/**
 * Tek bir kaynagi indirir. Metin ya da binary olabilir.
 * @returns {Promise<{ok:boolean, buffer:Buffer, contentType:string, finalUrl:string, status:number}>}
 */
export async function fetchResource(url, { timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const ab = await res.arrayBuffer();
    return {
      ok: res.ok,
      status: res.status,
      buffer: Buffer.from(ab),
      contentType: (res.headers.get('content-type') || '').toLowerCase(),
      finalUrl: res.url || url,
    };
  } catch (err) {
    return { ok: false, status: 0, buffer: Buffer.alloc(0), contentType: '', finalUrl: url, error: err };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, opts) {
  const r = await fetchResource(url, opts);
  return { ...r, text: r.buffer.toString('utf8') };
}

/** Goreli/mutlak URL'yi cozer. data: ve # gibi durumlari atlar. */
export function resolveUrl(base, ref) {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('blob:')
  ) {
    return null;
  }
  try {
    return new URL(trimmed, base).href;
  } catch {
    return null;
  }
}
