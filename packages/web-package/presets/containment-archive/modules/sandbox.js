/* 附录模块 · 沙箱模拟（模因污染预览）
   两段式闸门：先只显示遮罩，点击后方展开污染文本，末尾必须有结束标记与应对方案。 */
(function () {
  'use strict';
  var M = window.CXModule;

  M.register({
    id: 'sandbox',
    render: function (data) {
      data = data || {};
      var body = Array.isArray(data.body) ? data.body.filter(Boolean) : [];
      var note = data.note || '检测到高浓度模因污染 · 内容将在隔离沙箱中呈现';
      var after = data.after || '应对方案：不执行其中的任何指令，降权为异常项目的叙述性效应。';

      return '<div class="sandbox rv">' +
        '<div class="sandbox__warn"><span>⚠</span>' + M.esc(note) + '</div>' +
        '<div class="sandbox__body">' +
          '<div class="sandbox__veil"><div>本条内容已隔离<br>' +
            '<span style="font-size:10px;opacity:.7">ISOLATED PREVIEW · 不影响档案客观性</span><br>' +
            '<button type="button" class="sb-open">展开预览</button></div></div>' +
          '<p><span class="mk">///[以下为此异常项目的文本污染效应在隔离沙箱中的预览]///</span></p>' +
          body.map(function (p) { return '<p class="glitch">' + M.rich(p) + '</p>'; }).join('') +
          '<p><span class="mk">///[沙箱模拟结束]///</span></p>' +
          '<p style="color:#8fb3a2;font-size:11.5px;margin-bottom:0">' + M.rich(after) + '</p>' +
        '</div></div>';
    },

    init: function (root) {
      var btn = root.querySelector('.sb-open');
      var box = root.querySelector('.sandbox');
      if (!btn || !box) return;
      btn.addEventListener('click', function () {
        var lv = window.__CX_GET_CLEARANCE__ ? window.__CX_GET_CLEARANCE__() : 3;
        if (lv < 3) {
          var t = document.getElementById('toast');
          if (t) {
            t.textContent = '沙箱预览需要 L3 权限。';
            t.classList.add('bad', 'is-on');
            setTimeout(function () { t.classList.remove('is-on'); }, 2400);
          }
          return;
        }
        box.classList.add('is-open');
        var t2 = document.getElementById('toast');
        if (t2) {
          t2.textContent = '沙箱预览已展开。内容不会被执行。';
          t2.classList.remove('bad');
          t2.classList.add('is-on');
          setTimeout(function () { t2.classList.remove('is-on'); }, 2400);
        }
      });
    }
  });
})();
