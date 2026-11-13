/* 附录模块 · 监控录像
   数据结构：{ title, cam, site, date, tag, entries:[{t, v, cap}] }
   t 为秒数；v 为转写内容；cap 为画面说明。 */
(function () {
  'use strict';
  var M = window.CXModule;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function fmtFull(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return [h, m, s].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
  }

  M.register({
    id: 'log',
    render: function (data) {
      data = data || {};
      var entries = Array.isArray(data.entries) ? data.entries.filter(function (e) {
        return e && (e.v || e.cap);
      }) : [];
      entries.forEach(function (e) { e.t = Math.max(0, Math.floor(Number(e.t) || 0)); });
      entries.sort(function (a, b) { return a.t - b.t; });

      var duration = Math.max(60, (entries.length ? entries[entries.length - 1].t : 0) + 10, Number(data.duration) || 0);
      var head = '<b>' + M.esc(data.title || '监控录像') + '</b>' +
        (data.cam ? '<span>CAM-' + M.esc(data.cam) + '</span>' : '') +
        (data.tag ? '<span class="tag">' + M.esc(data.tag) + '</span>' : '');

      var list = entries.map(function (e) {
        return '<li data-t="' + e.t + '"><time>' + fmtFull(e.t) + '</time><span>' + M.rich(e.v || '') +
          (e.cap ? '<span class="cap">' + M.rich(e.cap) + '</span>' : '') + '</span></li>';
      }).join('');

      return '<div class="appx rv"><div class="appx__head">' + head + '</div>' +
        '<div class="appx__body"><div class="vlog"><div>' +
          '<div class="vscreen"><canvas class="v-canvas"></canvas>' +
            '<div class="osd tl">CAM-' + M.esc(data.cam || '—') + ' · ' + M.esc(data.site || '—') + '</div>' +
            '<div class="osd tr">REC</div>' +
            '<div class="osd bl v-clock">00:00:00</div>' +
            '<div class="osd br">' + M.esc(data.date || '—') + '</div>' +
          '</div>' +
          '<div class="vctrl"><button type="button" class="v-play" aria-label="播放">▶</button>' +
            '<input type="range" class="v-seek" min="0" max="' + duration + '" value="0" aria-label="进度">' +
            '<time class="v-time">00:00 / ' + fmt(duration) + '</time></div>' +
        '</div><ul class="vlines">' + list + '</ul></div></div></div>';
    },

    init: function (root, data) {
      var cv = root.querySelector('.v-canvas');
      if (!cv) return;
      var ctx = cv.getContext('2d');
      var entries = Array.prototype.slice.call(root.querySelectorAll('.vlines li'));
      var seek = root.querySelector('.v-seek');
      var playBtn = root.querySelector('.v-play');
      var clock = root.querySelector('.v-clock');
      var timeEl = root.querySelector('.v-time');
      var DUR = seek ? +seek.max : 60;
      var t = 0, playing = false, timer = null;

      function render() {
        var W = cv.width = cv.clientWidth || 300;
        var H = cv.height = cv.clientHeight || 200;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0b0d0b'; ctx.fillRect(0, 0, W, H);
        var vx = W / 2, vy = H * 0.46;
        ctx.strokeStyle = 'rgba(159,224,184,.35)';
        ctx.lineWidth = 1;
        [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (c) {
          ctx.beginPath();
          ctx.moveTo(c[0], c[1]);
          ctx.lineTo(vx + (c[0] ? 26 : -26), vy + (c[1] ? 22 : -22));
          ctx.stroke();
        });
        for (var k = 1; k < 6; k++) {
          var f = k / 6, s = Math.pow(f, 1.6);
          var lx = (vx - 26) * s, rx = W - (W - vx - 26) * s, ty = (vy - 22) * s, by = H - (H - vy - 22) * s;
          ctx.strokeStyle = 'rgba(159,224,184,' + (0.08 + f * 0.1) + ')';
          ctx.strokeRect(lx, ty, rx - lx, by - ty);
        }
        var open = Math.min(1, Math.max(0, (t - 18) / 10)) * (t < 88 ? 1 : 0);
        ctx.fillStyle = 'rgba(159,224,184,.12)';
        ctx.fillRect(vx - 26, vy - 22, 52, 44);
        ctx.fillStyle = '#000';
        ctx.fillRect(vx - 14, vy - 16, 28 * open, 38);
        ctx.strokeStyle = 'rgba(159,224,184,.6)';
        ctx.strokeRect(vx - 14, vy - 16, 28, 38);
        if (t >= 35 && t < 88) {
          var px = W * 0.78 - Math.min(1, (t - 35) / 40) * W * 0.12;
          ctx.fillStyle = 'rgba(0,0,0,.9)';
          ctx.beginPath(); ctx.ellipse(px, H * 0.52, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(px - 14, H * 0.6, 28, H * 0.4);
        }
        if (t >= 70 && t < 74 && Math.floor(t * 4) % 2 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(0, 0, W, H);
        }
        if (W > 0 && H > 0) {
          try {
            var img = ctx.getImageData(0, 0, W, H), d = img.data;
            var n = (t >= 70 && t < 76) ? 70 : 22;
            for (var i = 0; i < d.length; i += 16) {
              var r = (Math.random() - 0.5) * n;
              d[i] += r; d[i + 1] += r; d[i + 2] += r;
            }
            ctx.putImageData(img, 0, 0);
          } catch (e) { /* 画布被限制时保留画面，不阻断播放 */ }
        }
        if (clock) clock.textContent = fmtFull(t);
        if (timeEl) timeEl.textContent = fmt(t) + ' / ' + fmt(DUR);
        if (seek) seek.value = t;
        var cur = -1;
        entries.forEach(function (li, i) { if (t >= +li.dataset.t) cur = i; });
        entries.forEach(function (li, i) {
          li.classList.toggle('is-now', i === cur);
          li.classList.toggle('is-past', i < cur);
        });
      }

      function play(on) {
        playing = on;
        if (playBtn) playBtn.textContent = on ? '❚❚' : '▶';
        clearInterval(timer);
        if (on) {
          if (t >= DUR) t = 0;
          timer = setInterval(function () {
            t += 0.25;
            if (t >= DUR) { t = DUR; play(false); }
            render();
          }, 50);
        }
      }

      if (playBtn) playBtn.addEventListener('click', function () { play(!playing); });
      if (seek) seek.addEventListener('input', function () { t = +seek.value; render(); });
      entries.forEach(function (li) {
        li.addEventListener('click', function () { t = +li.dataset.t; render(); });
      });
      window.addEventListener('resize', render);
      render();
    }
  });
})();
