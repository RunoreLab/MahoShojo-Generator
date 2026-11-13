/* 附录模块 · 访谈记录 */
(function () {
  'use strict';
  var M = window.CXModule;

  function say(subject, who, text, note) {
    return '<div class="say' + (subject ? ' subj' : '') + '">' +
      '<span class="who">' + M.esc(who) + '</span>' +
      '<span class="bubble">' + M.rich(text || '') +
      (note ? '<br>（' + M.rich(note) + '）' : '') + '</span></div>';
  }

  M.register({
    id: 'interview',
    render: function (data) {
      data = data || {};
      var lines = Array.isArray(data.lines) ? data.lines.filter(Boolean) : [];
      var head = '<b>' + M.esc(data.title || '访谈记录') + '</b>' +
        (data.date ? '<span>日期 ' + M.esc(data.date) + '</span>' : '') +
        (data.tag ? '<span class="tag">' + M.esc(data.tag) + '</span>' : '');

      var body = '';
      if (data.subject || data.interviewer || data.preamble) {
        body += '<div class="pre">' +
          (data.subject ? '<b>受访者：</b>' + M.esc(data.subject) + '　' : '') +
          (data.interviewer ? '<b>采访者：</b>' + M.esc(data.interviewer) : '') +
          (data.preamble ? '<br><b>前言：</b>' + M.rich(data.preamble) : '') +
          '</div>';
      }
      if (lines.length) body += '<div class="mark">记录开始</div>';
      lines.forEach(function (ln) {
        if (ln.q) body += say(false, data.interviewer || '采访者', ln.q);
        if (ln.a) body += say(true, data.subject || '受访者', ln.a, ln.note);
      });
      if (lines.length) body += '<div class="mark">记录结束</div>';
      if (data.after) body += '<div class="post"><b>结语：</b>' + M.rich(data.after) + '</div>';

      return '<div class="appx rv"><div class="appx__head">' + head + '</div>' +
        '<div class="appx__body"><div class="talk">' + body + '</div></div></div>';
    }
  });
})();
