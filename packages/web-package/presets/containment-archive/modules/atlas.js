/* 附录模块 · 山海图志 */
(function () {
  'use strict';
  var M = window.CXModule;

  M.register({
    id: 'atlas',
    render: function (data) {
      data = data || {};
      var text = Array.isArray(data.text) ? data.text.filter(Boolean) : [];
      var beast = data.beast || '无';
      var caption = data.caption || M.beastCaption(beast);
      return '<div class="atlas rv" id="atlas" data-beast="' + M.esc(beast) + '">' +
        '<div class="atlas__text">' + M.paras(text) + '</div>' +
        '<div class="atlas__fig">' + M.beastSvg(beast) +
        '<div class="atlas__cap">' + M.esc(caption) + '</div></div></div>';
    }
  });
})();
