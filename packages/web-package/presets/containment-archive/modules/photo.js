/* 附录模块 · 影像资料
   数据结构：{ note, items:[{art, cap, no, note, rotate}] }
   art 可选 corridor / object / document / exterior。 */
(function () {
  'use strict';
  var M = window.CXModule;

  var ART = {
    corridor: '<svg viewBox="0 0 200 150" aria-hidden="true"><rect width="200" height="150" fill="#22201b"/>' +
      '<path d="M0 118 L48 96 L92 110 L140 84 L200 104 V150 H0 Z" fill="#2e2b25"/>' +
      '<path d="M70 118 V60 H130 V118" fill="none" stroke="#4a463c" stroke-width="2"/>' +
      '<path d="M86 60 V118 M114 60 V118" stroke="#4a463c" stroke-width="1"/>' +
      '<circle cx="150" cy="42" r="13" fill="#3a372f"/><circle cx="46" cy="36" r="8" fill="#3a372f"/></svg>',
    object: '<svg viewBox="0 0 200 150" aria-hidden="true"><rect width="200" height="150" fill="#1f1d19"/>' +
      '<path d="M40 130 Q60 70 100 64 Q140 58 158 130" fill="none" stroke="#4a463c" stroke-width="2"/>' +
      '<path d="M100 64 V130 M62 100 H138" stroke="#403c34" stroke-width="1.4"/>' +
      '<circle cx="100" cy="52" r="12" fill="#3a372f"/></svg>',
    document: '<svg viewBox="0 0 200 150" aria-hidden="true"><rect width="200" height="150" fill="#211f1a"/>' +
      '<rect x="48" y="24" width="104" height="112" fill="#3a352b" transform="rotate(-4 100 80)"/>' +
      '<path d="M62 48 H138 M62 68 H128 M62 88 H134 M62 108 H120" stroke="#6b6251" stroke-width="1.4"/>' +
      '<circle cx="146" cy="118" r="10" fill="none" stroke="#8a2b22" stroke-width="2"/></svg>',
    exterior: '<svg viewBox="0 0 200 150" aria-hidden="true"><rect width="200" height="150" fill="#22201b"/>' +
      '<path d="M0 150 L60 40 L100 86 L132 52 L200 150 Z" fill="#2b2822"/>' +
      '<path d="M96 92 L120 58 L146 96 Z" fill="#33302a"/>' +
      '<path d="M18 128 Q100 112 182 130" stroke="#46423a" stroke-width="1.6" fill="none" stroke-dasharray="5 4"/></svg>'
  };

  M.register({
    id: 'photo',
    render: function (data) {
      data = data || {};
      var items = Array.isArray(data.items) ? data.items.filter(Boolean) : [];
      if (data.note) {
        return '<p class="rv" style="font-size:13.5px;color:var(--ink-2)">' + M.rich(data.note) + '</p>' +
          gallery(items);
      }
      return gallery(items);
    },

    init: function (root) {
      var lightbox = document.getElementById('lightbox');
      var toast = function (msg) {
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.remove('bad');
        t.classList.add('is-on');
        clearTimeout(t.__cxTimer);
        t.__cxTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2400);
      };
      Array.prototype.slice.call(root.querySelectorAll('.photo')).forEach(function (p) {
        function enhanceOrOpen() {
          if (!p.classList.contains('is-enh')) {
            p.classList.add('is-scan');
            setTimeout(function () { p.classList.remove('is-scan'); p.classList.add('is-enh'); }, 1000);
            toast('增强解析中……再次点击可放大查看。');
            return;
          }
          if (!lightbox) return;
          var body = document.getElementById('lbBody');
          var cap = document.getElementById('lbCap');
          var meta = document.getElementById('lbMeta');
          var img = p.querySelector('.photo__img');
          if (body && img) body.innerHTML = img.innerHTML;
          if (cap) cap.textContent = p.dataset.cap || '';
          if (meta) meta.textContent = p.dataset.meta || '';
          lightbox.classList.add('is-on');
        }
        p.addEventListener('click', enhanceOrOpen);
        p.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enhanceOrOpen(); }
        });
      });
      if (lightbox && !lightbox.__cxBound) {
        lightbox.__cxBound = true;
        lightbox.addEventListener('click', function () { this.classList.remove('is-on'); });
      }
    }
  });

  function gallery(items) {
    if (!items.length) return '';
    return '<div class="gallery rv">' + items.map(function (it, i) {
      var art = ART[it.art] || ART.corridor;
      var rot = it.rotate == null ? ((i % 3) - 1) * 1.2 : Number(it.rotate);
      return '<figure class="photo" style="--r:' + rot + 'deg" data-cap="' + M.esc(it.cap || '') +
        '" data-meta="档案图号 ' + M.esc(it.no || '') + '" tabindex="0" role="button" aria-label="查看影像：' + M.esc(it.cap || '') + '">' +
        '<span class="tape"></span><div class="photo__img">' + art + '</div>' +
        (it.note ? '<div class="photo__note">' + M.rich(it.note) + '</div>' : '') +
        '<figcaption class="photo__cap"><span>' + M.esc(it.cap || '—') + '</span><b>' + M.esc(it.no || '—') + '</b></figcaption></figure>';
    }).join('') + '</div>';
  }
})();
