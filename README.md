# Sellauth Cloner

Sellauth Cloner is a Node.js command-line tool that converts the rendered frontend
of an existing website into a Sellauth-compatible theme.

It is designed for storefront owners and theme developers who want to preserve a
website's visual layout while using Sellauth's native product, cart, checkout,
customer and template system underneath.

> This project clones the presentation layer. It does not copy the source site's
> backend, database, authentication system, payments, private APIs or business logic.

## What it does

Given a public URL, the tool:

1. Opens the page in headless Chromium through Puppeteer.
2. Waits for JavaScript-rendered content and scrolls the page to trigger lazy loading.
3. Captures the final DOM after rendering.
4. Converts same-origin links to Sellauth's `shopUrl` format.
5. Preserves the source page's visible body as a Nunjucks component.
6. Detects common product grids and replaces static product values with Sellauth data.
7. Discovers linked pages on the same host and maps them to Sellauth templates.
8. Overlays the reusable theme files in `sellauth-base/`.
9. Validates generated Nunjucks templates.
10. Creates a Sellauth-compatible ZIP archive.

The result is a theme package, not a standalone static website.

## Requirements

- Windows 10 or Windows 11
- Node.js 20 or newer
- npm, included with Node.js
- Internet access during the first installation and while cloning remote assets

Puppeteer may download a compatible Chromium browser during the first `npm install`.
The first installation can therefore take longer than later runs.

## Quick start

### Windows one-click launcher

Double-click:

```text
baronsaplar.bat
```

The launcher checks for Node.js and npm, installs dependencies when needed, and
starts the interactive URL prompt.

You can also pass a URL directly:

```bat
baronsaplar.bat https://example.com
```

### Manual start

```bash
npm install
npm start
```

Or run a single clone without entering interactive mode:

```bash
node src/index.js https://example.com
```

When no URL argument is supplied, the CLI accepts multiple URLs one after another.
Type `exit` or `q` to close it.

## How the pipeline works

### 1. Browser rendering

`src/renderer.js` launches Puppeteer with a desktop viewport, waits for network
activity to settle, waits for common application content, scrolls through the page,
and returns the final HTML and redirect URL.

This allows the tool to capture content that does not exist in the initial HTTP
response, including JavaScript-rendered sections and lazy-loaded elements.

If Chromium cannot be launched, the tool falls back to a regular `fetch` request and
continues with the returned HTML.

### 2. HTML transformation

`src/transformer.js` parses the document with Cheerio and prepares it for Nunjucks:

- titles and metadata are moved into `snippets/meta-tags.njk`;
- stylesheet, icon, preload and font links are preserved;
- inline CSS URLs are made absolute;
- same-host anchor and form links are converted to Sellauth URLs;
- known analytics and tracking scripts are removed;
- problematic template-like sequences are sanitized;
- the page body is written as a single `components/cloned.njk` component.

The original page structure and CSS class names are intentionally kept as much as
possible so the visual design remains recognizable.

### 3. Product detection and dynamic data

`src/injector.js` looks for common product patterns, including:

- links containing `/product/`;
- product card images;
- product title classes;
- price text such as `$12.00`, `12,00 EUR` or `100 TRY`;
- stock labels and product grid containers.

When a product grid is recognized, the source card is converted into a Nunjucks loop
using Sellauth fields such as:

```njk
{{ item.name }}
{{ item.image_url }}
{{ formatPrice(item.min_price, item.currency) }}
{{ ('/product/' + item.path) | shopUrl }}
```

This keeps the source card layout while allowing the Sellauth shop's real products
to populate it. Detection is heuristic and may require manual adjustment for an
unusual website structure.

### 4. Sellauth base theme

`src/writer.js` copies `sellauth-base/` into every generated theme. The base contains
the Sellauth-compatible Nunjucks templates and components for:

- navigation and footer;
- product and product-list pages;
- product detail and purchase forms;
- cart and checkout;
- customer dashboard pages;
- feedback, status, blog and policy pages;
- shared snippets and frontend scripts.

Product detail, cart and checkout behavior comes from these Sellauth components.
The source website's private API or payment implementation is not copied.

### 5. Secondary pages

The initial page is scanned for same-origin links. Common paths are mapped as follows:

| Source path pattern | Sellauth template |
| --- | --- |
| `/product/...` | Native dynamic product page |
| `/products...` | Products page |
| `/cart...` | Cart page |
| `/feedback...` | Feedback page |
| `/customer...`, `/profile...`, `/account...` | Customer dashboard |
| `terms`, `privacy`, `refund` | Policy templates |
| `status` | Status page |
| `/blog...` | Blog template |
| Other paths | Custom page |

The crawler discovers links from the initial rendered page only and creates at most
one cloned component per template type.

## Generated output

Each run creates a timestamped directory and a ZIP beside it:

```text
output/
  example-com-2026-01-01T12-00-00/
    assets/
    components/
      cloned.njk
      products.njk
      product-page.njk
      cart-page.njk
    layouts/
      master.njk
    templates/
    snippets/
    schema.json
    settings.json
    settings.default.json
  example-com-2026-01-01T12-00-00.zip
```

The generated ZIP can be uploaded as a Sellauth theme package.

## Asset behavior and limitations

The current main pipeline does not make every source asset local. Source CSS,
images, fonts and JavaScript are generally converted to absolute URLs and remain
loaded from the original host or CDN.

This means the generated theme is not guaranteed to work offline. If the original
host removes an image, changes a stylesheet, blocks hotlinking or changes its URLs,
the generated appearance may change or break.

The bundled Sellauth base assets are included locally:

```text
assets/custom.css
assets/pro.css
assets/script.js
assets/hero.jpg
```

`src/assets.js` contains an asset manager capable of downloading and rewriting CSS
dependencies, but the current primary transformation path intentionally keeps source
assets remote. This is an area for future improvement if fully self-contained ZIPs
are required.

Other practical limitations:

- product detection is heuristic, not a universal parser;
- login-protected pages cannot be captured without an authenticated browser flow;
- WebSocket-only or private-API content is not reproduced;
- multiple custom pages of the same inferred template type may be collapsed into one;
- generated templates are syntax-checked, but not fully tested in a live Sellauth shop;
- source scripts may still be present unless they match the cleanup rules;
- the source site's legal content, branding and media remain the user's responsibility.

## Capturing HTML manually

Some sites block headless browsers. For that situation, `grab-server.js` provides a
small local receiver on port `8099`:

```bash
node grab-server.js
```

The receiver stores POSTed HTML files in `_grabbed/`. Then run:

```bash
node clone-local.js
```

The local workflow expects files such as:

```text
_grabbed/home.html
_grabbed/feedback.html
_grabbed/cart.html
```

`grab-server.js` has no authentication and should only be used on a trusted local
machine. Do not expose it to the public internet.

## Project structure

```text
src/index.js        CLI entry point and clone orchestration
src/renderer.js     Puppeteer/Chromium rendering
src/fetcher.js      HTTP fetching and URL resolution
src/assets.js       Asset naming and CSS URL rewriting utilities
src/transformer.js  HTML-to-Nunjucks transformation
src/injector.js     Heuristic product and feedback injection
src/writer.js       Base theme overlay and generated files
src/validate.js     Nunjucks syntax validation
src/zip.js          Independent ZIP writer
sellauth-base/      Reusable Sellauth theme components and templates
clone-local.js      Offline HTML capture workflow
grab-server.js      Local HTML capture receiver
baronsaplar.bat     Windows launcher
```

## Development checks

The project has no external test suite yet. Useful local checks include:

```bash
node --check src/index.js
npm ls --depth=0
npm start
```

After a clone, inspect the generated `components/cloned.njk`, `layouts/master.njk`
and `settings.json` files before uploading the theme.

## Legal and responsible use

Only clone websites, assets and text that you own or have permission to reproduce.
Do not use this tool to impersonate another business, bypass authentication, copy
private data, or misrepresent the origin of a design. The user is responsible for
copyright, trademark, privacy, terms-of-service and third-party asset compliance.

## Status

Sellauth Cloner is a functional, purpose-built prototype. It works well for sites
whose structure matches the supported patterns, but it is not a universal website
mirror or a fully offline archival system.
