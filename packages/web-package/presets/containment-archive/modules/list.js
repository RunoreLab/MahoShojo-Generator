/* 附录模块 · 清单 / 物证 */
(function () {
  'use strict';
  var M = window.CXModule;

  var STATUS = {
    ok: ['完好', 'ok'],
    wt: ['待检', 'wt'],
    ng: ['缺损', 'ng'],
    un: ['不明', 'ng']
  };

  M.register({
    id: 'list',
    render: function (data) {
      data = data || {};
      var items = Array.isArray(data.items) ? data.items.filter(Boolean) : [];
      if (!items.length) return '';
      var note = data.note ? '<p class="rv" style="font-size:13px;color:var(--ink-3);margin-bottom:10px">' + M.rich(data.note) + '</p>' : '';
      return note + '<table class="tbl rv"><thead><tr><th>编号</th><th>名称</th><th>数量</th><th>状态</th><th>备注</th></tr></thead><tbody>' +
        items.map(function (it) {
          var st = STATUS[it.status] || STATUS.ok;
          return '<tr><td class="mono">' + M.esc(it.no || '—') + '</td>' +
            '<td>' + M.esc(it.name || '—') + '</td>' +
            '<td>' + M.esc(it.qty == null ? '—' : it.qty) + '</td>' +
            '<td><span class="st ' + st[1] + '">' + st[0] + '</span></td>' +
            '<td>' + M.rich(it.note || '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
  });
})();
