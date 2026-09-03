'use strict';
// 共享聚合逻辑：抓取分类下所有 RSS 源 -> 解析 -> 去重 -> 按时间倒序
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const feeds = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'feeds.json'), 'utf8')
);
const CATEGORIES = ['ai', 'security'];
const ITEM_LIMIT = 60;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟内存缓存
const FETCH_TIMEOUT_MS = 4000; // 单源超时：留足 Vercel 免费函数 10s 上限余量

const cache = new Map(); // cat -> { at, data, inflight }
const parser = new Parser({ timeout: FETCH_TIMEOUT_MS });

function parseDate(item) {
  const raw = item.isoDate || item.pubDate || item.date;
  const d = raw ? new Date(raw) : new Date(NaN);
  return isNaN(d.getTime()) ? null : d;
}

function cleanSummary(item) {
  let s = item.contentSnippet || item.content || item.summary || '';
  s = String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 320 ? s.slice(0, 320) + '…' : s;
}

function keyOf(item) {
  return (item.link || item.guid || item.title || '').trim().toLowerCase();
}

// 并发抓取单分类，带并发上限，单个源失败不拖垮整体
async function fetchCategoryNow(cat) {
  const list = feeds[cat] || [];
  const MAX_CONCURRENT = 8;
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const feed = list[idx++];
      const entry = { source: feed, ok: false, error: '', count: 0, items: [] };
      try {
        let parsed = null;
        for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
          try {
            parsed = await parser.parseURL(feed.url);
          } catch (firstErr) {
            if (attempt === 0) {
              // 瞬时错误（连接重置等）重试一次
              await new Promise((r) => setTimeout(r, 400));
            } else {
              throw firstErr;
            }
          }
        }
        entry.ok = true;
        entry.title = parsed.title || feed.name;
        const items = (parsed.items || []).map((it) => ({
          title: (it.title || '').trim(),
          link: it.link || '',
          guid: it.guid || '',
          pubDate: it.isoDate || it.pubDate || '',
          date: parseDate(it),
          summary: cleanSummary(it),
          source: parsed.title || feed.name,
          feedUrl: feed.url,
          home: feed.home || '',
          category: cat
        }));
        const seen = new Set();
        entry.items = items.filter((it) => {
          if (!it.title) return false;
          const k = keyOf(it);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        entry.count = entry.items.length;
      } catch (err) {
        entry.error = (err && err.message) || String(err);
      }
      results.push(entry);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENT, list.length || 1); i++) workers.push(worker());
  await Promise.all(workers);

  // 跨源去重（标题相似度/链接），再按时间倒序
  const allItems = [];
  const globalSeen = new Set();
  for (const e of results) {
    for (const it of e.items) {
      const k = keyOf(it) || it.title.trim().toLowerCase();
      if (globalSeen.has(k)) continue;
      globalSeen.add(k);
      allItems.push(it);
    }
  }
  allItems.sort((a, b) => {
    const ta = a.date ? a.date.getTime() : 0;
    const tb = b.date ? b.date.getTime() : 0;
    return tb - ta;
  });

  const okCount = results.filter((r) => r.ok).length;
  return {
    ok: true,
    category: cat,
    updatedAt: new Date().toISOString(),
    sourcesTotal: list.length,
    sourcesOk: okCount,
    sources: results.map((r) => ({
      name: r.source ? r.source.name || r.source : r.source,
      feedUrl: r.source && r.source.url ? r.source.url : '',
      ok: r.ok,
      error: r.error || '',
      count: r.count
    })),
    items: allItems.slice(0, ITEM_LIMIT),
    total: allItems.length
  };
}

function getCategory(cat) {
  if (!CATEGORIES.includes(cat)) return Promise.reject(new Error('unknown category: ' + cat));
  const now = Date.now();
  const hit = cache.get(cat);
  if (hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.data);

  if (hit && hit.inflight) return hit.inflight;
  const p = fetchCategoryNow(cat)
    .then((data) => {
      cache.set(cat, { at: Date.now(), data, inflight: null });
      return data;
    })
    .catch((err) => {
      cache.delete(cat);
      throw err;
    });
  cache.set(cat, { at: now, inflight: p, data: null });
  return p;
}

async function getAll() {
  const [ai, security] = await Promise.all([getCategory('ai'), getCategory('security')]);
  const items = ai.items.concat(security.items).sort((a, b) => {
    const ta = a.date ? a.date.getTime() : 0;
    const tb = b.date ? b.date.getTime() : 0;
    return tb - ta;
  });
  return {
    ok: true,
    category: 'all',
    updatedAt: new Date().toISOString(),
    sourcesTotal: ai.sourcesTotal + security.sourcesTotal,
    sourcesOk: ai.sourcesOk + security.sourcesOk,
    ai: { total: ai.total, sourcesOk: ai.sourcesOk },
    security: { total: security.total, sourcesOk: security.sourcesOk },
    items
  };
}

module.exports = { getCategory, getAll, CATEGORIES, feeds };


