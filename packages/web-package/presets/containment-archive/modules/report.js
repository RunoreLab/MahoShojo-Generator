/* 模块 · 行动报告 */
(function () {
  'use strict';
  var M = window.CXModule;

  M.register({
    id: 'report',
    render: function (data) {
      data = data || {};
      var body = Array.isArray(data.body) ? data.body.filter(Boolean) : [];
      if (!body.length && data.text) body = [data.text];
      return '<div class="report-body rv">' + M.paras(body) + '</div>';
    }
  });
})();
