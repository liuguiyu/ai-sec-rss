'use strict';
// 共享聚合逻辑：抓取分类下所有 RSS 源 -> 解析 -> 去重 -> 按时间倒序
const Parser = require('rss-parser');
const iconv = require('iconv-lite');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const feeds = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'feeds.json'), 'utf8')
);
const CATEGORIES = ['ai', 'security'];
const ITEM_LIMIT = 60;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟内存缓存
// 单源超时：默认 4s 兼顾 Vercel 免费函数 10s 上限；Render 等常驻服务可用 FEED_TIMEOUT_MS 调大
const FETCH_TIMEOUT_MS = Math.max(2000, Number(process.env.FEED_TIMEOUT_MS) || 4000);
const MAX_REDIRECTS = 3;
// 不少中文站点会拦截默认 UA（rss-parser/node），统一使用浏览器 UA
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 泛科技类源的选题过滤：feeds.json 中给源加 "filter": "ai" 后，仅保留与主题相关的条目
const TOPIC_PATTERNS = {
  ai: /(\bAI\b|\bAIGC\b|\bLLMs?\b|\bGPT\b|ChatGPT|Claude|Gemini|Copilot|NVIDIA|OpenAI|Anthropic|DeepSeek|通义|文心|豆包|Kimi|英伟达|人工智能|大模型|大语言模型|语言模型|生成式|机器学习|深度学习|神经网络|智能体|多模态|算力|具身智能|自动驾驶|机器人|强化学习|模型训练|开源模型|智能驾驶|AI\s*芯片|智能眼镜|智能音箱)/i
};

const cache = new Map(); // cat -> { at, data, inflight }
const parser = new Parser();

function jarFrom(headers) {
  const raw = headers['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((c) => String(c).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

// 带超时/重定向的原始请求：保留 Buffer 才能按源声明编码解码（部分中文源是 GBK）
function httpGet(url, opts) {
  const options = opts || {};
  const left = typeof options.redirectsLeft === 'number' ? options.redirectsLeft : MAX_REDIRECTS;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('bad url: ' + url));
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: options.html
        ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        : 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
    };
    if (options.referer) headers.Referer = options.referer;
    if (options.cookie) headers.Cookie = options.cookie;
    const req = lib.get(
      target,
      { headers },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && left > 0) {
          res.resume();
          const next = { referer: options.referer, cookie: options.cookie, html: options.html, redirectsLeft: left - 1 };
          resolve(httpGet(new URL(res.headers.location, target).toString(), next));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error('HTTP ' + status));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 8 * 1024 * 1024) {
            req.destroy(new Error('feed too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), headers: res.headers }));
        res.on('error', reject);
      }
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('timeout after ' + FETCH_TIMEOUT_MS + 'ms')));
    req.on('error', reject);
  });
}

// 部分中文源在 WAF 之后（如 FreeBuf 用阿里云盾）：直接抓订阅源会被判 405/403，
// 先访问站点首页拿到 WAF 下发的 cookie，再带着 cookie 重试订阅源
async function httpGetWithRetry(url) {
  let referer = '';
  try {
    referer = new URL(url).origin + '/';
  } catch (err) {
    referer = '';
  }
  try {
    return await httpGet(url, { referer });
  } catch (err) {
    if (!referer || !/HTTP (401|403|405)/.test(String((err && err.message) || err))) throw err;
    const home = await httpGet(referer, { html: true }).catch(() => null);
    if (!home) throw err;
    const cookie = jarFrom(home.headers);
    if (!cookie) throw err;
    return httpGet(url, { referer, cookie });
  }
}

// 从 XML 声明 / HTTP 头识别编码，非 UTF-8（GBK、GB2312 等）用 iconv 解码，避免中文乱码
function decodeBody(buffer, headers) {
  const head = buffer.subarray(0, 2048).toString('latin1');
  const fromXml = head.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  const fromHttp = String(headers['content-type'] || '').match(/charset=["']?([\w-]+)/i);
  const charset = String((fromXml && fromXml[1]) || (fromHttp && fromHttp[1]) || 'utf-8').toLowerCase();
  if (!charset || charset === 'utf-8' || charset === 'utf8' || charset === 'ascii') {
    return buffer.toString('utf8');
  }
  try {
    return iconv.decode(buffer, charset);
  } catch (err) {
    return buffer.toString('utf8');
  }
}

async function fetchFeed(url) {
  const { buffer, headers } = await httpGetWithRetry(url);
  return parser.parseString(decodeBody(buffer, headers));
}
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
            parsed = await fetchFeed(feed.url);
          } catch (err) {
            if (attempt === 0) {
              // 瞬时错误（连接重置等）重试一次
              await new Promise((r) => setTimeout(r, 400));
            } else {
              throw err;
            }
          }
        }
        entry.ok = true;
        entry.title = parsed.title || feed.name;
        // maxItems：给条目量极大的源设上限，避免刷屏挤占其它源（如 MSRC 有 5000+ 条）
        const cap = Number(feed.maxItems) > 0 ? Number(feed.maxItems) : Infinity;
        const items = (parsed.items || []).slice(0, cap).map((it) => ({
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
        const pattern = feed.filter && TOPIC_PATTERNS[feed.filter];
        entry.items = items.filter((it) => {
          if (!it.title) return false;
          if (pattern && !pattern.test(it.title)) return false;
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
