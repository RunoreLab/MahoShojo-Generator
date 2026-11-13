/* 附录模块 · 收容地点舆图
   数据结构：{ region, scale, points:[{x, y, name, coord, text}] } */
(function () {
  'use strict';
  var M = window.CXModule;

  function mountain(x, y, s) {
    return '<path class="mtn" d="M' + (x - 30 * s) + ' ' + y + ' Q' + (x - 14 * s) + ' ' + (y - 26 * s) + ' ' + x + ' ' + (y - 40 * s) +
      ' Q' + (x + 14 * s) + ' ' + (y - 26 * s) + ' ' + (x + 30 * s) + ' ' + y + '"/>' +
      '<path class="mtn" d="M' + (x - 10 * s) + ' ' + (y - 18 * s) + ' Q' + x + ' ' + (y - 28 * s) + ' ' + (x + 6 * s) + ' ' + (y - 14 * s) + '" opacity=".6"/>';
  }

  M.register({
    id: 'map',
    render: function (data) {
      data = data || {};
      var points = Array.isArray(data.points) ? data.points.filter(Boolean) : [];
      var region = data.region || '收容地点';
      var scale = data.scale || '比例尺未标注';

      var bg = '<g class="grid">';
      for (var x = 0; x <= 800; x += 50) bg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="420"/>';
      for (var y = 0; y <= 420; y += 50) bg += '<line x1="0" y1="' + y + '" x2="800" y2="' + y + '"/>';
      bg += '</g>';
      [[120, 120, 1.2], [170, 110, .9], [90, 150, .8], [560, 90, 1.3], [610, 100, 1], [640, 130, .8], [300, 320, 1], [340, 330, .7], [690, 340, 1.1], [460, 210, .7]]
        .forEach(function (m) { bg += mountain(m[0], m[1], m[2]); });
      bg += '<path class="river" d="M0 260 Q120 230 210 270 T420 250 T620 220 T800 250"/>';
      bg += '<path class="river" d="M420 250 Q440 300 410 360 T430 420" opacity=".7"/>';
      bg += '<path d="M240 60 q10 -14 24 -4 q8 -12 22 -2 q14 -2 12 12 q-10 8 -22 2 q-14 8 -24 -2 q-14 4 -12 -6" fill="none" stroke="currentColor" stroke-width=".8" opacity=".35" style="color:var(--ink-3)"/>';
      bg += '<path d="M680 40 q10 -14 24 -4 q8 -12 22 -2 q14 -2 12 12 q-10 8 -22 2 q-14 8 -24 -2" fill="none" stroke="currentColor" stroke-width=".8" opacity=".35" style="color:var(--ink-3)"/>';
      bg += '<text x="400" y="34" text-anchor="middle" font-size="16" fill="var(--ink-2)" font-family="KaiTi,STKaiti,serif" letter-spacing="8">' + M.esc(region) + '舆图</text>';
      bg += '<rect x="680" y="380" width="100" height="4" fill="var(--ink-2)"/><rect x="680" y="380" width="50" height="4" fill="var(--paper-2)" stroke="var(--ink-2)"/>';
      bg += '<text x="730" y="398" text-anchor="middle" font-size="9" fill="var(--ink-3)" font-family="Consolas,monospace">' + M.esc(scale) + '</text>';

      points.forEach(function (p, i) {
        var px = Math.max(10, Math.min(790, Number(p.x) || 400));
        var py = Math.max(10, Math.min(410, Number(p.y) || 210));
        bg += '<g class="pin" data-i="' + i + '" tabindex="0" role="button" aria-label="' + M.esc(p.name || '标记') + '">' +
          '<circle class="ring" cx="' + px + '" cy="' + py + '" r="6"/>' +
          '<circle class="core" cx="' + px + '" cy="' + py + '" r="5"/>' +
          '<text x="' + (px + 10) + '" y="' + (py - 8) + '">' + M.esc(p.name || '') + '</text></g>';
      });

      var first = points[0] || {};
      var info = '<h5>' + M.esc(first.name || '未标注坐标点') + '</h5>' +
        '<div class="coord">' + M.esc(first.coord || '—') + '</div>' +
        '<p style="margin:6px 0 0">' + M.rich(first.text || '点击图上标记切换查看。') + '</p>';

      return '<div class="map rv">' +
        '<svg class="map-svg" id="mapSvg" viewBox="0 0 800 420" role="img" aria-label="' + M.esc(region) + '舆图">' + bg + '</svg>' +
        '<div class="map__info" id="mapInfo">' + info + '</div>' +
        '<svg class="map__compass" viewBox="0 0 64 64" aria-hidden="true">' +
          '<circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="1"/>' +
          '<path d="M32 8 L37 32 L32 56 L27 32 Z" fill="currentColor" opacity=".7"/>' +
          '<text x="32" y="6" text-anchor="middle" font-size="8" fill="currentColor">N</text>' +
        '</svg></div>';
    },

    init: function (root, data) {
      data = data || {};
      var points = Array.isArray(data.points) ? data.points.filter(Boolean) : [];
      var svg = root.querySelector('.map-svg');
      var info = root.querySelector('.map__info');
      if (!svg || !points.length) return;

      function select(i) {
        var p = points[i];
        if (!p) return;
        Array.prototype.slice.call(svg.querySelectorAll('.pin')).forEach(function (g) {
          g.classList.toggle('is-on', +g.dataset.i === i);
        });
        if (info) {
          info.innerHTML = '<h5>' + M.esc(p.name || '—') + '</h5>' +
            '<div class="coord">' + M.esc(p.coord || '—') + '</div>' +
            '<p style="margin:6px 0 0">' + M.rich(p.text || '') + '</p>';
        }
      }

      Array.prototype.slice.call(svg.querySelectorAll('.pin')).forEach(function (g) {
        g.addEventListener('click', function () { select(+g.dataset.i); });
        g.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(+g.dataset.i); }
        });
      });
      select(0);
    }
  });
})();
