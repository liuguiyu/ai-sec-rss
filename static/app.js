'use strict';
(function () {
  const state = {
    cat: 'ai',
    data: null,        // 当前分类的最近一次结果
    search: '',
    source: 'all',
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
    subAi: document.getElementById('sub-ai'),
    subSec: document.getElementById('sub-security')
  };
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
      if (state.source !== 'all' && it.feedUrl !== state.source) return false;
      if (!q) return true;
      return (it.title || '').toLowerCase().indexOf(q) >= 0
        || (it.summary || '').toLowerCase().indexOf(q) >= 0
        || (it.source || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function render() {
    if (!state.data) { skeleton(); return; }
    const list = filteredItems();
    els.count.textContent = state.data.total
      ? '共 ' + state.data.total + ' 条，显示 ' + list.length + ' 条'
      : (state.data.error ? '' : '暂无条目');
    if (!list.length) {
      showEmpty(state.search || state.source !== 'all' ? '没有匹配的内容' : '该分类暂无内容，可能所有源暂时不可用');
      return;
    }
    const html = list.map(function (it) {
      const fresh = isFresh(it.pubDate) ? '<span class="tag">新</span>' : '';
      const t = esc(it.title || '无标题');
      const s = esc(it.summary || '');
      const src = esc(it.source || '未知源');
      const when = timeAgo(it.pubDate);
      const link = esc(it.link || '#');
      return '<a class="card" data-cat="' + esc(state.cat) + '" href="' + link + '" target="_blank" rel="noopener noreferrer">'
        + '<div class="card-head"><span class="source">' + src + '</span>'
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

  async function loadCat(cat) {
    if (state.loading) return;
    state.loading = true;
    state.cat = cat;
    document.querySelectorAll('.cat').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-cat') === cat);
    });
    skeleton();
    try {
      const res = await fetch('/api/feeds?cat=' + encodeURIComponent(cat) + '&t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || 'bad response');
      state.data = data;
      updateSources(data);
      render();
      els.list.classList.remove('refreshed');
      void els.list.offsetWidth; // 重启动画
      els.list.classList.add('refreshed');
    } catch (err) {
      state.data = { items: [], total: 0, error: (err && err.message) || String(err) };
      showError((err && err.message) || String(err));
      els.updated.textContent = '';
    } finally {
      state.loading = false;
    }
  }

  function setCatFromHash() {
    const h = location.hash.replace('#', '');
    loadCat(h === 'security' ? 'security' : 'ai');
  }

  els.nav.addEventListener('click', function (e) {
    const btn = e.target.closest('.cat');
    if (!btn) return;
    history.replaceState(null, '', '#' + btn.getAttribute('data-cat'));
    loadCat(btn.getAttribute('data-cat'));
  });
  els.search.addEventListener('input', function () { els.list.classList.remove('refreshed'); render(); });
  els.source.addEventListener('change', function () { state.source = els.source.value; els.list.classList.remove('refreshed'); render(); });
  els.refresh.addEventListener('click', function () { loadCat(state.cat); });

  window.addEventListener('hashchange', setCatFromHash);
  window.addEventListener('error', function (e) {
    // 依赖 window.onerror 保底
  });

  setCatFromHash();
  setInterval(function () {
    if (!document.hidden) loadCat(state.cat);
  }, 10 * 60 * 1000);
})();
