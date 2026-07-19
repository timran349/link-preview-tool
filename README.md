# Link Preview Inspector

See how a link looks everywhere it's shared — Google search result, X, Facebook,
LinkedIn cards, and every meta tag behind them.

It's a single self-contained file (`index.html` — HTML, CSS, and JS all in one),
so there's nothing to build or install to just open it.

## Run it locally

**Easiest — open directly:**
Double-click `index.html`, or drag it into a browser tab.

> ⚠️ Don't open it through Claude's in-app file preview — that preview sandboxes
> outbound network requests and blocks the CORS proxy this tool needs. Open the
> downloaded file directly in a normal browser tab instead.

**With VS Code:**
1. Open this folder in VS Code (`File > Open Folder…`).
2. Install the **Live Server** extension (by Ritwick Dey), if you don't have it.
3. Right-click `index.html` → **Open with Live Server**.
   - This runs it at `http://127.0.0.1:5500` with auto-reload on save.

**With Node (no extension needed):**
```bash
npm run dev
```
This starts a static server at `http://localhost:3000` (uses `npx serve`, no install required — needs Node.js).

## How it works

- Paste a URL and click **Inspect**.
- On production (Vercel), the page is fetched through the same-origin
  serverless proxy at `/api/proxy` — fast and reliable.
- If the local proxy is unavailable (e.g. opening `index.html` directly),
  public CORS proxies are used as fallbacks:
  1. `api.allorigins.win`
  2. `api.codetabs.com`
  3. `corsproxy.io`
- Meta tags (`og:title`, `og:description`, `og:image`, Twitter Card tags, etc.)
  are parsed out and rendered into platform-accurate preview cards.

## Customizing

Everything lives in `index.html`:
- Colors and fonts are CSS custom properties at the top of the `<style>` block
  (`--bg`, `--accent`, etc.) and the `@import` for Google Fonts.
- Preview card markup/styling is grouped by platform (`.lp-google`, `.lp-x`,
  `.lp-fb`, `.lp-li`).
- Fetch + parsing logic is in the `<script>` block at the bottom
  (`fetchWithProxies`, `getMeta`, `inspect`).

## Known limitations

- Sites that block datacenter traffic, or return non-HTML responses, won't
  resolve — you'll see a clear error rather than a silent failure.
- Deploy on Vercel (or any host that runs `/api/proxy.js`) for reliable
  production fetches. Pure static hosts only get the public CORS fallbacks.
