/* 附录模块 · 事件时间轴 */
(function () {
  'use strict';
  var M = window.CXModule;

  M.register({
    id: 'timeline',
    render: function (data) {
      data = data || {};
      var events = Array.isArray(data.events) ? data.events.filter(Boolean) : [];
      if (!events.length) return '';
      return '<div class="tl rv">' + events.map(function (e) {
        return '<div class="tl__item' + (e.crit ? ' crit' : '') + '">' +
          '<div class="tl__time">' + M.esc(e.date || e.time || '—') + '</div>' +
          '<div class="tl__title">' + M.esc(e.title || '—') + '</div>' +
          '<div class="tl__desc">' + M.rich(e.text || '') + '</div></div>';
      }).join('') + '</div>';
    }
  });
})();
