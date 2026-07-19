const FETCH_TIMEOUT_MS = 5500;
const MAX_HEAD_BYTES = 96_000; // meta tags live in <head> — stop early

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const parts = m.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function attr(tag, name) {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
    'i'
  );
  const m = tag.match(re);
  return m ? decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim()) : null;
}

function getMeta(html, keys) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of keys) {
    const want = key.toLowerCase();
    for (const tag of tags) {
      const prop = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
      if (prop !== want) continue;
      const content = attr(tag, 'content');
      if (content) return content;
    }
  }
  return null;
}

function getTitle(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : null;
}

function getFavicon(html) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const ranked = [];
  for (const tag of links) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    if (!/\bicon\b/.test(rel) && !/\bshortcut\b/.test(rel) && !/\bapple-touch-icon\b/.test(rel)) {
      continue;
    }
    const href = attr(tag, 'href');
    if (!href) continue;
    let score = 1;
    if (rel.includes('apple-touch-icon')) score = 2;
    if (rel === 'icon' || rel.includes('shortcut')) score = 3;
    const sizes = attr(tag, 'sizes');
    if (sizes && /(\d+)x\1/i.test(sizes)) {
      score += Math.min(parseInt(sizes, 10) || 0, 128) / 128;
    }
    ranked.push({ href, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.href || null;
}

function extractMeta(html, pageUrl) {
  const title = getTitle(html);
  const description = getMeta(html, ['description']);
  const ogTitle = getMeta(html, ['og:title']);
  const ogDescription = getMeta(html, ['og:description']);
  const ogImage = getMeta(html, ['og:image', 'og:image:url']);
  const ogSiteName = getMeta(html, ['og:site_name']);
  const ogType = getMeta(html, ['og:type']);
  const twitterCard = getMeta(html, ['twitter:card']);
  const twitterTitle = getMeta(html, ['twitter:title']);
  const twitterDescription = getMeta(html, ['twitter:description']);
  const twitterImage = getMeta(html, ['twitter:image', 'twitter:image:src']);
  const themeColor = getMeta(html, ['theme-color', 'msapplication-TileColor']);
  const favicon = getFavicon(html);

  return {
    ok: true,
    url: pageUrl,
    title,
    description,
    favicon,
    themeColor,
    og: {
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      site_name: ogSiteName,
      type: ogType,
    },
    twitter: {
      card: twitterCard,
      title: twitterTitle,
      description: twitterDescription,
      image: twitterImage,
    },
  };
}

async function readHeadOnly(upstream) {
  if (!upstream.body || typeof upstream.body.getReader !== 'function') {
    const full = await upstream.text();
    const cut = full.search(/<\/head>/i);
    return cut === -1 ? full.slice(0, MAX_HEAD_BYTES) : full.slice(0, cut + 7);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });

      const headEnd = text.search(/<\/head>/i);
      if (headEnd !== -1) {
        text = text.slice(0, headEnd + 7);
        break;
      }
      // Enough bytes for meta tags even without a clean </head>
      if (total >= MAX_HEAD_BYTES) break;
    }
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }

  return text;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache parsed meta at the edge for 10 minutes
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawUrl = req.query?.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch (err) {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    res.status(400).json({ error: 'Only http and https URLs are supported' });
    return;
  }

  if (isPrivateHost(targetUrl.hostname)) {
    res.status(400).json({ error: 'Private or local addresses are not allowed' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        // Hint that we only care about the document start
        Range: 'bytes=0-96000',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const headHtml = await readHeadOnly(upstream);
    const meta = extractMeta(headHtml, targetUrl.toString());

    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Upstream-Status', String(upstream.status));
    res.setHeader('X-Head-Bytes', String(headHtml.length));
    res.end(JSON.stringify(meta));
  } catch (err) {
    console.error('proxy failed', err);
    const aborted =
      err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')));
    res.status(502).json({
      error: aborted
        ? 'Timed out fetching the requested URL'
        : 'Unable to fetch the requested URL',
    });
  } finally {
    clearTimeout(timer);
  }
};
