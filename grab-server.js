// grab-server.js - Tarayicidan POST'lanan HTML'i _grabbed/<name>.html olarak kaydeder.
// adservice puppeteer'i engelledigi icin HTML'i gercek tarayicidan aliyoruz.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '_grabbed');
fs.mkdirSync(DIR, { recursive: true });

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST') {
      const url = new URL(req.url, 'http://localhost');
      const name = (url.searchParams.get('name') || 'page').replace(/[^a-z0-9_-]/gi, '_');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        fs.writeFileSync(path.join(DIR, name + '.html'), body, 'utf8');
        console.log(`kaydedildi: ${name}.html (${(body.length / 1024).toFixed(1)} KB)`);
        res.writeHead(200);
        res.end('ok');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(8099, () => console.log('grab-server calisiyor: http://localhost:8099'));
