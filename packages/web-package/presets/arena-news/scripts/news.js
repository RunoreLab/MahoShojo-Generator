/* Arena News optional DOM helpers. Classic script; no storage, network or HTML injection. */
(() => {
  'use strict';
  if (window.ArenaNews) return;
  const mounted = new WeakSet();
  function mount(root = document) {
    if (mounted.has(root)) return;
    mounted.add(root);
    const all = (selector) => Array.from(root.querySelectorAll(selector));
    const matchesKey = (selector, attribute, key) => all(selector).filter((element) => element.getAttribute(attribute) === key);
    const votes = new Map();
    const toggles = new Map();
    const comments = new Map();
    let query = '';
    let category = 'all';
    const announce = (message) => {
      all('[data-news-status]').forEach((element) => {
        element.setAttribute('role', 'status');
        element.setAttribute('aria-live', 'polite');
        element.textContent = message;
      });
    };
    function route(focus) {
      const panels = all('[data-news-view]');
      if (!panels.length) return;
      let key;
      try { key = decodeURIComponent(location.hash.slice(1)) || 'home'; } catch { key = 'home'; }
      let panel = panels.find((element) => element.dataset.newsView === key);
      if (!panel) {
        panel = panels.find((element) => element.dataset.newsView === 'home') || panels[0];
        announce('未找到该页面，已显示首页。');
      }
      panels.forEach((element) => { element.hidden = element !== panel; });
      all('a[data-news-link]').forEach((link) => {
        let target;
        try { target = decodeURIComponent((link.getAttribute('href') || '').replace(/^#/, '')); } catch { target = ''; }
        if (target === panel.dataset.newsView) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      if (focus) {
        const heading = panel.querySelector('h1,h2,h3') || panel;
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    }
    function filter() {
      const items = all('[data-news-item]');
      let count = 0;
      items.forEach((item) => {
        const haystack = (item.dataset.newsSearch || item.textContent || '').toLocaleLowerCase();
        const tags = (item.dataset.newsCategory || '').split(/\s+/);
        const visible = (!query || haystack.includes(query)) && (category === 'all' || tags.includes(category));
        item.hidden = !visible;
        if (visible) count += 1;
      });
      all('[data-news-empty]').forEach((element) => { element.hidden = count !== 0; });
      all('[data-news-result-count]').forEach((element) => { element.textContent = String(count); });
      announce(`找到 ${count} 条新闻。`);
    }
    function toggle(button) {
      const key = button.dataset.newsToggle;
      if (!key) return;
      const active = !(toggles.get(key) || false);
      toggles.set(key, active);
      matchesKey('[data-news-toggle]', 'data-news-toggle', key).forEach((element) => {
        element.setAttribute('aria-pressed', String(active));
        const label = element.querySelector('[data-news-toggle-label]');
        if (label) label.textContent = active ? (element.dataset.newsOn || '已选择') : (element.dataset.newsOff || '选择');
        const count = element.querySelector('[data-news-toggle-count]');
        if (count) {
          const rawBase = Number(element.dataset.newsBase || 0);
          const base = Number.isFinite(rawBase) ? Math.max(0, Math.floor(rawBase)) : 0;
          count.textContent = String(base + Number(active));
        }
      });
      announce(active ? '已记录，仅本次浏览有效。' : '已取消。');
    }
    function vote(button) {
      const key = button.dataset.newsPoll;
      if (!key || votes.has(key)) return;
      const choice = button.dataset.newsChoice || button.textContent.trim();
      votes.set(key, choice);
      matchesKey('[data-news-poll]', 'data-news-poll', key).forEach((element) => {
        element.disabled = true;
        element.setAttribute('aria-pressed', String(element === button));
      });
      matchesKey('[data-news-poll-result]', 'data-news-poll-result', key).forEach((element) => {
        element.textContent = `你的模拟投票：${choice}。仅本次浏览有效，未发送到服务器。`;
      });
      announce(`已投票：${choice}。`);
    }
    const isSimulationForm = (form) => form instanceof HTMLFormElement &&
      (form.hasAttribute('data-news-comments') || form.hasAttribute('data-news-subscribe'));
    function handleSimulationForm(form) {
      if (!form.reportValidity()) return;
      if (form.hasAttribute('data-news-subscribe')) {
        announce('已模拟订阅本报；没有收集或发送任何信息，刷新后重置。');
        form.reset();
        return;
      }
      const key = form.dataset.newsComments;
      const input = form.elements.namedItem('comment');
      const authorInput = form.elements.namedItem('author');
      if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)) return;
      const body = input.value.trim().slice(0, 1000);
      if (!body) { announce('请先输入评论内容。'); input.focus(); return; }
      const lists = matchesKey('[data-news-comment-list]', 'data-news-comment-list', key);
      if (!lists.length) { announce('此文章尚未设置评论列表。'); return; }
      const previous = comments.get(key) || 0;
      if (previous >= 50) { announce('本次浏览已达到 50 条评论上限。'); return; }
      const author = (authorInput && typeof authorInput.value === 'string' ? authorInput.value.trim().slice(0, 40) : '') || '现场读者';
      lists.forEach((list) => {
        const article = document.createElement(list.matches('ul,ol') ? 'li' : 'article');
        article.className = 'news-comment';
        const name = document.createElement('strong');
        name.textContent = author;
        const content = document.createElement('p');
        content.textContent = body;
        article.append(name, content);
        list.append(article);
      });
      comments.set(key, previous + 1);
      input.value = '';
      announce('评论已显示；只在本次浏览内保留。');
      input.focus();
    }
    root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || event.defaultPrevented) return;
      const submitter = event.target.closest('button,input');
      if (submitter && submitter.type === 'submit' && !submitter.matches(':disabled') && isSimulationForm(submitter.form)) {
        // Opaque sandbox permits scripts but blocks native form submission before
        // a submit event fires. Handle simulation directly without requestSubmit.
        event.preventDefault();
        handleSimulationForm(submitter.form);
        return;
      }
      const link = event.target.closest('a[href]');
      if (link) {
        const fragment = link.getAttribute('href');
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
            link.hasAttribute('download') || (link.target && link.target !== '_self') ||
            !fragment.startsWith('#') || !all('[data-news-view]').length) return;
        let key;
        try { key = decodeURIComponent(fragment.slice(1)) || 'home'; } catch { key = 'home'; }
        const isView = all('[data-news-view]').some((element) => element.dataset.newsView === key);
        const anchor = document.getElementById(key);
        // srcdoc inherits the host base URL. Native fragment links can reload the host
        // inside this iframe; use the current document's location, never link.href.
        event.preventDefault();
        if (!isView && !link.hasAttribute('data-news-link') && anchor) {
          anchor.scrollIntoView?.();
          if (!anchor.hasAttribute('tabindex')) anchor.setAttribute('tabindex', '-1');
          anchor.focus();
          return;
        }
        const previousHash = location.hash;
        location.hash = fragment;
        if (location.hash === previousHash) route(true);
        return;
      }
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.hasAttribute('data-news-toggle')) { event.preventDefault(); toggle(button); }
      if (button.hasAttribute('data-news-poll')) { event.preventDefault(); vote(button); }
      if (button.hasAttribute('data-news-action')) {
        event.preventDefault();
        announce(button.dataset.newsMessage || '模拟操作已完成，未进行交易或发送请求。');
      }
    });
    root.addEventListener('input', (event) => {
      if (!(event.target instanceof Element) || !event.target.matches('[data-news-query]')) return;
      query = event.target.value.trim().toLocaleLowerCase();
      filter();
    });
    root.addEventListener('change', (event) => {
      if (!(event.target instanceof Element) || !event.target.matches('select[data-news-filter]')) return;
      category = event.target.value;
      filter();
    });
    root.addEventListener('submit', (event) => {
      if (!isSimulationForm(event.target)) return;
      event.preventDefault();
      handleSimulationForm(event.target);
    });
    root.addEventListener('keydown', (event) => {
      const input = event.target;
      if (event.defaultPrevented || event.key !== 'Enter' || event.isComposing || event.repeat ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          !(input instanceof HTMLInputElement) || input.matches(':disabled') ||
          !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(input.type) ||
          !isSimulationForm(input.form)) return;
      event.preventDefault();
      handleSimulationForm(input.form);
    });
    all('[data-news-status]').forEach((element) => { element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite'); });
    all('[data-news-toggle]').forEach((element) => { element.setAttribute('aria-pressed', 'false'); });
    const queryInput = all('[data-news-query]')[0];
    const categoryInput = all('select[data-news-filter]')[0];
    query = queryInput ? queryInput.value.trim().toLocaleLowerCase() : '';
    category = categoryInput ? categoryInput.value : 'all';
    if (all('[data-news-item]').length) filter();
    route(false);
    window.addEventListener('hashchange', () => route(true));
  }
  window.ArenaNews = Object.freeze({ mount });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  else mount();
})();
