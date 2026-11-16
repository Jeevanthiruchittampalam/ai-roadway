#!/usr/bin/env node
// Collects recent AI headlines from public feeds, files them under the day they were
// published (data/news/YYYY-MM.json) and picks the "latest big news" for the site.
// No dependencies, no API keys. Run daily by .github/workflows/daily-news.yml.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DIR = new URL('../data/news/', import.meta.url);
const DAY = 86400000, NOW = Date.now();
const KEEP_DAYS = 10;      // how far back a feed item may be dated and still be filed
const BIG_WINDOW = 14;     // "latest big news" must be at most this many days old
const PER_DAY = 15;

const FEEDS = [
  { s: 'OpenAI', u: 'https://openai.com/news/rss.xml', w: 3 },
  { s: 'Google DeepMind', u: 'https://deepmind.google/blog/rss.xml', w: 3 },
  { s: 'Google AI', u: 'https://blog.google/technology/ai/rss/', w: 2 },
  { s: 'MIT Technology Review', u: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', w: 2 },
  { s: 'The Guardian', u: 'https://www.theguardian.com/technology/artificialintelligenceai/rss', w: 2 },
  { s: 'TechCrunch', u: 'https://techcrunch.com/category/artificial-intelligence/feed/', w: 1 },
  { s: 'The Verge', u: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', w: 1 },
  { s: 'Ars Technica', u: 'https://arstechnica.com/ai/feed/', w: 1 },
  { s: 'VentureBeat', u: 'https://venturebeat.com/category/ai/feed/', w: 1 },
  { s: 'Wired', u: 'https://www.wired.com/feed/tag/ai/latest/rss', w: 1 },
];
const HN_QUERIES = ['AI', 'LLM', 'OpenAI', 'Anthropic', 'DeepMind', 'AGI'];
const AI_WORDS = /\b(AI|A\.I\.|LLMs?|GPT|OpenAI|Anthropic|Claude|Gemini|DeepMind|AGI|superintelligence|neural net\w*|machine learning|chatbots?|AI agents?|Nvidia)\b/i;
const HOT = [
  /\b(launch|releas|unveil|announc|introduc|debut)/i,
  /\b(AGI|superintelligen\w*|breakthrough|first|record|landmark|historic)\b/i,
  /\b(billion|trillion|acqui\w*|merger|IPO)\b/i,
  /\b(law|regulat\w*|ban|bans|lawsuit|court|senate|congress|white house|executive order|treaty)\b/i,
  /\b(OpenAI|Anthropic|DeepMind|Google|Meta|Microsoft|Nvidia|xAI|Apple|Amazon)\b/i,
  /\b(GPT|Claude|Gemini|Llama|Grok|Sora)\b/i,
];
const STOP = new Set('about after again against also amid been being from have into just more most over says said than that their them then there these they this what when where which while will with would your could should'.split(' '));

const get = async (url, json) => {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; news-aggregator/1.0)', accept: '*/*' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return json ? r.json() : r.text();
};
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (x, n) => (x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i')) || [])[1] || '';

function parseFeed(xml) {
  return (xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || []).map(b => {
    let link = decode(tag(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? m[1].replace(/&amp;/g, '&') : '';
    }
    return { t: decode(tag(b, 'title')), u: link, at: Date.parse(decode(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))) };
  });
}
const cleanUrl = u => { try { const x = new URL(u); [...x.searchParams.keys()].filter(k => /^(utm_|ref$|source$)/.test(k)).forEach(k => x.searchParams.delete(k)); x.hash = ''; return x.toString(); } catch { return ''; } };
const tokens = t => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 3 && !STOP.has(w)));
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const readJson = async (name, fallback) => { try { return JSON.parse(await readFile(new URL(name, DIR), 'utf8')); } catch { return fallback; } };

// ---- gather ----
let found = [];
for (const f of FEEDS) {
  try {
    const items = parseFeed(await get(f.u));
    items.forEach(i => found.push({ ...i, s: f.s, base: f.w }));
    console.log(`✓ ${f.s}: ${items.length}`);
  } catch (e) { console.log(`✗ ${f.s}: ${e.message}`); }
}
const since = Math.floor((NOW - KEEP_DAYS * DAY) / 1000);
for (const q of HN_QUERIES) {
  try {
    const j = await get(`https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(q)}&numericFilters=points%3E200,created_at_i%3E${since}&hitsPerPage=30`, true);
    for (const h of j.hits || []) if (h.title && AI_WORDS.test(h.title))
      found.push({ t: h.title, u: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, at: h.created_at_i * 1000, s: 'Hacker News', base: 1 + Math.min(4, (h.points || 0) / 250) });
  } catch (e) { console.log(`✗ Hacker News (${q}): ${e.message}`); }
}

// ---- clean, dedupe, score ----
const seen = new Set();
found = found.map(i => ({ ...i, u: cleanUrl(i.u) })).filter(i => {
  if (!i.t || i.t.length < 12 || !/^https?:\/\//.test(i.u) || !Number.isFinite(i.at)) return false;
  if (i.at > NOW + DAY / 2 || i.at < NOW - KEEP_DAYS * DAY) return false;
  const k1 = i.u, k2 = i.t.toLowerCase().replace(/\W+/g, '');
  if (seen.has(k1) || seen.has(k2)) return false;
  seen.add(k1); seen.add(k2); return true;
});
found.forEach(i => { i.tok = tokens(i.t); });
for (const i of found) {
  const echo = new Set();     // other outlets covering the same story around the same time
  for (const j of found) {
    if (j === i || j.s === i.s || Math.abs(j.at - i.at) > 2 * DAY) continue;
    let shared = 0; for (const w of i.tok) if (j.tok.has(w)) shared++;
    if (shared >= 3 && shared / Math.min(i.tok.size, j.tok.size) >= 0.4) echo.add(j.s);
  }
  i.score = Math.round((i.base + HOT.filter(r => r.test(i.t)).length + 2 * echo.size) * 10) / 10;
}
console.log(`${found.length} fresh headlines`);

// ---- file by day ----
await mkdir(DIR, { recursive: true });
const months = {};
const month = async key => months[key] || (months[key] = await readJson(`${key}.json`, {}));
for (const i of found) {
  const d = dayOf(i.at), m = await month(d.slice(0, 7));
  const list = m[d] || (m[d] = []);
  const old = list.find(x => x.u === i.u || x.t === i.t);
  if (old) old.score = Math.max(old.score || 0, i.score);
  else list.push({ t: i.t.slice(0, 200), u: i.u, s: i.s, score: i.score });
}
for (const [key, m] of Object.entries(months)) {
  const sorted = {};
  for (const d of Object.keys(m).sort()) sorted[d] = m[d].sort((a, b) => b.score - a.score).slice(0, PER_DAY);
  await writeFile(new URL(`${key}.json`, DIR), JSON.stringify(sorted, null, 1) + '\n');
}

// ---- index + latest big news ----
const idx = await readJson('index.json', {});
const allMonths = [...new Set([...(idx.months || []), ...Object.keys(months)])].sort();
let big = null, runners = [];
for (const key of [dayOf(NOW - 31 * DAY).slice(0, 7), dayOf(NOW).slice(0, 7)].filter((k, n, a) => a.indexOf(k) === n)) {
  const m = await readJson(`${key}.json`, {});
  for (const [d, list] of Object.entries(m)) {
    const age = (NOW - Date.parse(d)) / DAY;
    if (age > BIG_WINDOW || age < -1) continue;
    for (const x of list) runners.push({ d, t: x.t, u: x.u, s: x.s, rank: x.score - 0.3 * Math.max(0, age) });
  }
}
runners.sort((a, b) => b.rank - a.rank);
big = runners[0] || idx.big || null;
const strip = x => x && { d: x.d, t: x.t, u: x.u, s: x.s };
const firstDay = idx.firstDay || Object.keys(months).flatMap(k => Object.keys(months[k])).sort()[0] || null;
await writeFile(new URL('index.json', DIR), JSON.stringify({ updated: new Date(NOW).toISOString(), firstDay, months: allMonths, big: strip(big), runnersUp: runners.slice(1, 5).map(strip) }, null, 1) + '\n');
console.log(big ? `Big news: ${big.t} (${big.s}, ${big.d})` : 'No big news found');
