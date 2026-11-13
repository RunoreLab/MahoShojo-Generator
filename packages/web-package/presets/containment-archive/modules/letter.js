/* 附录模块 · 封存信件 */
(function () {
  'use strict';
  var M = window.CXModule;

  M.register({
    id: 'letter',
    render: function (data) {
      data = data || {};
      var body = Array.isArray(data.body) ? data.body.filter(Boolean) : [];
      var label = data.label || '封存编号未标注 · 仅限 L4 以上启封';
      return '<div class="envelope-wrap rv">' +
        '<div class="envelope" role="button" tabindex="0" aria-label="拆开信件">' +
          '<div class="envelope__body"></div><div class="envelope__flap"></div>' +
          '<div class="envelope__wax">封</div>' +
          '<div class="envelope__label">' + M.esc(label) + '</div>' +
        '</div>' +
        '<div class="letter">' + (body.length ? M.paras(body) : '') +
          (data.sign || data.date
            ? '<p class="sign">——' + M.esc(data.sign || '—') +
              (data.date ? '<br><span style="font-family:var(--mono);font-size:10.5px">' + M.esc(data.date) + '</span>' : '') + '</p>'
            : '') +
        '</div></div>';
    },

    init: function (root) {
      var env = root.querySelector('.envelope');
      var letter = root.querySelector('.letter');
      if (!env || !letter) return;

      function getClearance() {
        return window.__CX_GET_CLEARANCE__ ? window.__CX_GET_CLEARANCE__() : 3;
      }

      function open() {
        if (env.classList.contains('is-open')) {
          env.classList.remove('is-open');
          letter.classList.remove('is-open');
          return;
        }
        if (getClearance() < 4) {
          env.animate([
            { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
            { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }
          ], { duration: 320 });
          var t = document.getElementById('toast');
          if (t) {
            t.textContent = '封蜡未松动：启封需要 L4 权限。';
            t.classList.add('bad', 'is-on');
            setTimeout(function () { t.classList.remove('is-on'); }, 2400);
          }
          return;
        }
        env.classList.add('is-open');
        setTimeout(function () { letter.classList.add('is-open'); }, 450);
      }

      env.addEventListener('click', open);
      env.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
  });
})();
