'use strict';
(function () {
  const state = {
    cat: 'ai',
    data: null,        // 当前分类的最近一次结果
    search: '',
    source: 'all',
    group: 'all',      // 安全分类的子标签页：all | vuln | news | malware
    pending: null,     // 后台刷新拿到、但还没展示的新数据
    loading: false
  };
  const els = {
    nav: document.getElementById('catNav'),
    list: document.getElementById('list'),
    search: document.getElementById('search'),
    source: document.getElementById('sourceFilter'),
    updated: document.getElementById('updated'),
    health: document.getElementById('health'),
    count: document.getElementById('itemCount'),
    refresh: document.getElementById('refreshBtn'),
    subNav: document.getElementById('subNav'),
    updateBar: document.getElementById('updateBar'),
    subAi: document.getElementById('sub-ai'),
    subSec: document.getElementById('sub-security')
  };
  const SEV_LABEL = { CRITICAL: '严重', HIGH: '高危', MEDIUM: '中危', LOW: '低危' };
  const META = {
    ai: { name: 'AI · 人工智能', color: '#7c8cf8' },
    security: { name: 'SECURITY · 网络安全', color: '#ff8f6b' }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const day = Math.floor(h / 24);
    if (day < 7) return day + ' 天前';
    return d.toLocaleDateString('zh-CN');
  }

  function isFresh(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return !isNaN(d.getTime()) && Date.now() - d.getTime() < 24 * 3600 * 1000;
  }

  function skeleton() {
    els.list.innerHTML = '<div class="skeleton">' + '<div class="sk"></div>'.repeat(7) + '</div>';
  }

  function showEmpty(text) {
    els.list.innerHTML = '<div class="empty">' + esc(text || '暂无内容') + '</div>';
  }

  function showError(text) {
    els.list.innerHTML = '<div class="empty">加载失败：' + esc(text) + '<br><button class="btn" onclick="location.reload()">重试</button></div>';
  }

  function filteredItems() {
    const items = state.data && state.data.items ? state.data.items : [];
    const q = state.search.trim().toLowerCase();
    return items.filter(function (it) {
      if (state.cat === 'security' && state.group !== 'all' && (it.group || '') !== state.group) return false;
      if (state.source !== 'all' && it.feedUrl !== state.source) return false;
      if (!q) return true;
      return (it.title || '').toLowerCase().indexOf(q) >= 0
        || (it.summary || '').toLowerCase().indexOf(q) >= 0
        || (it.source || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  // 安全分类的子标签页：切换分组、显示各分组条目数
  function renderSubcats(data) {
    const nav = els.subNav;
    if (!nav) return;
    const show = state.cat === 'security';
    nav.hidden = !show;
    if (!show) return;
    const groups = (data && data.groups) || {};
    nav.querySelectorAll('.subcat').forEach(function (b) {
      const g = b.getAttribute('data-group') || 'all';
      const count = g === 'all' ? ((data && data.total) || 0) : (groups[g] || 0);
      const span = b.querySelector('.n');
      if (span) span.textContent = count ? String(count) : '';
      b.classList.toggle('active', g === state.group);
    });
  }

  function countText(shown) {
    const d = state.data || {};
    const labels = { vuln: '漏洞 · CVE', news: '资讯分析', malware: '恶意软件' };
    if (state.cat === 'security' && state.group !== 'all' && labels[state.group]) {
      return labels[state.group] + ' · 共 ' + ((d.groups && d.groups[state.group]) || 0) + ' 条，显示 ' + shown + ' 条';
    }
    return '共 ' + (d.total || 0) + ' 条，显示 ' + shown + ' 条';
  }

  function render() {
    if (!state.data) { skeleton(); return; }
    const list = filteredItems();
    els.count.textContent = state.data.total ? countText(list.length) : (state.data.error ? '' : '暂无条目');
    if (!list.length) {
      const narrowed = state.search || state.source !== 'all' || (state.cat === 'security' && state.group !== 'all');
      showEmpty(narrowed ? '没有匹配的内容' : '该分类暂无内容，可能所有源暂时不可用');
      return;
    }
    const html = list.map(function (it) {
      const fresh = isFresh(it.pubDate) ? '<span class="tag">新</span>' : '';
      const t = esc(it.title || '无标题');
      const s = esc(it.summary || '');
      const src = esc(it.source || '未知源');
      const when = timeAgo(it.pubDate);
      const link = esc(it.link || '#');
      const badges = [];
      if (it.severity) {
        const label = SEV_LABEL[it.severity] || it.severity;
        badges.push('<span class="sev ' + esc(String(it.severity).toLowerCase()) + '">' + esc(label) + (it.cvss ? ' ' + esc(it.cvss) : '') + '</span>');
      } else if (it.cve) {
        badges.push('<span class="sev cve">' + esc(it.cve) + '</span>');
      }
      if (it.kev) badges.push('<span class="sev kev">在野利用</span>');
      return '<a class="card" data-cat="' + esc(state.cat) + '" href="' + link + '" target="_blank" rel="noopener noreferrer">'
        + '<div class="card-head"><span class="source">' + src + '</span>'
        + (badges.length ? '<span class="badges">' + badges.join('') + '</span>' : '')
        + (when ? '<span class="time">' + when + '</span>' : '') + '</div>'
        + '<h3>' + t + fresh + '</h3>'
        + (s ? '<p>' + s + '</p>' : '')
        + '<span class="go">阅读原文 ↗</span>'
        + '</a>';
    }).join('');
    els.list.innerHTML = html;
  }

  function updateSources(data) {
    // 来源下拉
    const sel = els.source;
    const prev = state.source;
    const opts = ['<option value="all">全部来源</option>'];
    (data.sources || []).forEach(function (s) {
      const label = s.name + (s.ok ? '' : '（失败）');
      opts.push('<option value="' + esc(s.feedUrl) + '">' + esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
    state.source = prev || 'all';
    sel.value = state.source;

    // 健康提示
    const total = data.sourcesTotal || 0;
    const ok = data.sourcesOk || 0;
    const fail = data.sources && data.sources.filter(function (s) { return !s.ok; });
    const failNames = (fail && fail.length ? fail.map(function (s) { return s.name + (s.error ? '：' + s.error : ''); }) : []);
    els.health.textContent = total ? ok + '/' + total + ' 源正常' : '';
    els.health.title = failNames.length ? '以下源暂时不可用：\n' + failNames.join('\n') : '全部源正常';
    els.health.style.color = ok === total ? 'var(--ok)' : 'var(--err)';

    els.updated.textContent = data.updatedAt ? '更新于 ' + timeAgo(data.updatedAt) : '';
    // 分类摘要
    // 当前分类摘要：动态显示源健康度
    var cat = state.cat;
    var subEl = (cat === 'ai') ? els.subAi : els.subSec;
    if (subEl) {
      subEl.textContent = ok + '/' + total + ' 源正常';
      subEl.style.color = (ok === total) ? 'var(--ok)' : 'var(--err)';
    }
  }

  function itemKey(it) {
    return it.link || it.guid || it.title || '';
  }

  function countNewItems(prev, next) {
    const seen = new Set(((prev && prev.items) || []).map(itemKey));
    return ((next && next.items) || []).filter(function (it) { return !seen.has(itemKey(it)); }).length;
  }

  function showUpdateBar(n) {
    if (!els.updateBar) return;
    els.updateBar.innerHTML = '<button type="button" class="newbar">↑ 有 ' + n + ' 条新内容 · 点击查看</button>';
    els.updateBar.hidden = false;
  }

  function hideUpdateBar() {
    if (!els.updateBar) return;
    els.updateBar.hidden = true;
    els.updateBar.innerHTML = '';
  }

  // 真正把数据画到页面上：只在首次进入 / 切换分类 / 用户主动刷新时调用
  function applyData(data) {
    state.data = data;
    state.pending = null;
    hideUpdateBar();
    updateSources(data);
    renderSubcats(data);
    render();
    els.list.classList.remove('refreshed');
    void els.list.offsetWidth; // 重启动画
    els.list.classList.add('refreshed');
  }

  let reqSeq = 0;

  async function loadCat(cat, opts) {
    const o = opts || {};
    const seq = ++reqSeq;
    const switched = state.cat !== cat || !state.data;
    state.loading = true;
    state.cat = cat;
    if (!o.silent) {
      document.querySelectorAll('.cat').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-cat') === cat);
      });
      if (switched && !o.keepList) skeleton();
    }
    try {
      const res = await fetch('/api/feeds?cat=' + encodeURIComponent(cat) + '&t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || 'bad response');
      if (seq !== reqSeq) return;
      if (o.silent) {
        // 后台刷新：绝不动正在阅读的页面，只在新内容出现时挂个提示条
        const n = countNewItems(state.data, data);
        if (n > 0) { state.pending = data; showUpdateBar(n); }
        else { els.updated.textContent = data.updatedAt ? '更新于 ' + timeAgo(data.updatedAt) : ''; }
        return;
      }
      applyData(data);
    } catch (err) {
      if (seq !== reqSeq || o.silent) return;
      if (!o.keepList || !state.data) {
        state.data = { items: [], total: 0, error: (err && err.message) || String(err) };
        showError((err && err.message) || String(err));
        els.updated.textContent = '';
      }
    } finally {
      if (seq === reqSeq) state.loading = false;
    }
  }

  function setCatFromHash() {
    const parts = location.hash.replace('#', '').split('/');
    const g = parts[1] || 'all';
    state.group = ['all', 'vuln', 'news', 'malware'].indexOf(g) >= 0 ? g : 'all';
    loadCat(parts[0] === 'security' ? 'security' : 'ai');
  }

  els.nav.addEventListener('click', function (e) {
    const btn = e.target.closest('.cat');
    if (!btn) return;
    const cat = btn.getAttribute('data-cat');
    const suffix = cat === 'security' && state.group !== 'all' ? '/' + state.group : '';
    history.replaceState(null, '', '#' + cat + suffix);
    loadCat(cat);
  });
  if (els.subNav) {
    els.subNav.addEventListener('click', function (e) {
      const btn = e.target.closest('.subcat');
      if (!btn) return;
      state.group = btn.getAttribute('data-group') || 'all';
      history.replaceState(null, '', state.group === 'all' ? '#security' : '#security/' + state.group);
      renderSubcats(state.data);
      els.list.classList.remove('refreshed');
      render();
    });
  }
  els.search.addEventListener('input', function () { els.list.classList.remove('refreshed'); render(); });
  els.source.addEventListener('change', function () { state.source = els.source.value; els.list.classList.remove('refreshed'); render(); });
  els.refresh.addEventListener('click', function () {
    if (state.loading) return;
    const btn = els.refresh;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '刷新中…';
    loadCat(state.cat, { keepList: true }).finally(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  });
  if (els.updateBar) {
    els.updateBar.addEventListener('click', function () {
      if (!state.pending) return;
      applyData(state.pending);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  window.addEventListener('hashchange', setCatFromHash);
  window.addEventListener('error', function (e) {
    // 依赖 window.onerror 保底
  });

  setCatFromHash();
  // 5 分钟后台静默刷新：有新内容只提示，不打断阅读
  setInterval(function () {
    if (!document.hidden) loadCat(state.cat, { silent: true });
  }, 5 * 60 * 1000);
})();
