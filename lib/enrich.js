'use strict';
// CVE 增强：NVD「最近 CVE」数据提供 CVSS 等级；CISA KEV 目录标记「在野利用」
const zlib = require('zlib');

const CVE_RE = /CVE-\d{4}-\d{4,7}/i;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NVD_RECENT = 'https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-recent.json.gz';
const CISA_KEV = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const state = {
  severity: { at: 0, map: null, inflight: null },
  kev: { at: 0, set: null, inflight: null }
};

function ready(entry, field) {
  return !!(entry[field] && Date.now() - entry.at < CACHE_TTL_MS);
}

async function fetchBuffer(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function pickCvss(metrics) {
  const m = metrics || {};
  const list = m.cvssMetricV31 || m.cvssMetricV30 || m.cvssMetricV2 || [];
  return (list[0] || {}).cvssData || {};
}

// CVE 编号 -> { severity, score }，来自 NVD 最近 8 天变动数据（约 1.4MB gz）
function loadSeverity() {
  const c = state.severity;
  if (ready(c, 'map')) return Promise.resolve(c.map);
  if (c.inflight) return c.inflight;
  c.inflight = (async () => {
    try {
      const buf = await fetchBuffer(NVD_RECENT, 30000);
      const json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
      const map = new Map();
      for (const v of json.vulnerabilities || []) {
        const cve = v.cve || {};
        if (!cve.id) continue;
        const data = pickCvss(cve.metrics);
        map.set(String(cve.id).toUpperCase(), {
          severity: data.baseSeverity || '',
          score: typeof data.baseScore === 'number' ? data.baseScore : null
        });
      }
      c.map = map;
      c.at = Date.now();
      return map;
    } finally {
      c.inflight = null;
    }
  })();
  return c.inflight;
}

// CISA 已知被利用漏洞目录（全量，约 1.7MB）
function loadKev() {
  const c = state.kev;
  if (ready(c, 'set')) return Promise.resolve(c.set);
  if (c.inflight) return c.inflight;
  c.inflight = (async () => {
    try {
      const buf = await fetchBuffer(CISA_KEV, 20000);
      const json = JSON.parse(buf.toString('utf8'));
      const set = new Set(
        (json.vulnerabilities || []).map((v) => String(v.cveID || '').toUpperCase()).filter(Boolean)
      );
      c.set = set;
      c.at = Date.now();
      return set;
    } finally {
      c.inflight = null;
    }
  })();
  return c.inflight;
}

function findCve(item) {
  if (item.cve) return item.cve;
  const text = String(item.title || '') + ' ' + String(item.summary || '');
  const m = text.match(CVE_RE);
  return m ? m[0].toUpperCase() : '';
}

// 给条目补 cve / severity / cvss / kev 字段。
// 数据没在预算内就绪时直接返回（后台继续拉取，下次刷新就有），不拖慢接口。
async function enrich(items, budgetMs) {
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : 2500;
  for (const it of items) it.cve = findCve(it);
  if (!items.some((it) => it.cve)) return;
  await Promise.race([
    Promise.all([loadSeverity().catch(() => null), loadKev().catch(() => null)]),
    new Promise((r) => setTimeout(r, budget))
  ]);
  const sevMap = ready(state.severity, 'map') ? state.severity.map : null;
  const kevSet = ready(state.kev, 'set') ? state.kev.set : null;
  for (const it of items) {
    if (!it.cve) continue;
    if (kevSet && kevSet.has(it.cve)) it.kev = true;
    const s = sevMap && sevMap.get(it.cve);
    if (s) {
      if (s.severity) it.severity = s.severity;
      if (s.score != null) it.cvss = s.score;
    }
  }
}

module.exports = { enrich, loadSeverity, loadKev, findCve };
