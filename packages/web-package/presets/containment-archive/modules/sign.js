/* 模块 · 签批
   数据结构：{ rows:[{role, en, name, date, stamp, need}], note }
   未给出 rows 时使用三个职务签章位，署名为职位而非人名。 */
(function () {
  'use strict';
  var M = window.CXModule;

  function defaults() {
    return [
      { role: '撰写 · AUTHOR', name: '档案科 · 值班撰写员', stamp: '撰', need: 1 },
      { role: '核对 · REVIEW', name: '档案科 · 核对员', stamp: '校', need: 3 },
      { role: '批准 · APPROVE', name: '档案科 · 值班主管', stamp: '准', need: 4 }
    ];
  }

  M.register({
    id: 'sign',
    render: function (data) {
      data = data || {};
      var rows = Array.isArray(data.rows) && data.rows.length ? data.rows.filter(Boolean) : defaults();
      var note = data.note || '本档案依《存续院档案撰写规范》编制。任何未加盖骑缝章的复印件均视为无效。如对本档案内容有异议，请于归档后三十日内向档案科提交书面说明。';

      return '<div class="sign-flow rv">' + rows.map(function (r, i) {
        return '<div tabindex="0" role="button" aria-label="' + M.esc(r.role || '签章位') + '">' +
          '<div class="role">' + M.esc(r.role || '签批') + '</div>' +
          '<div class="name">' + M.esc(r.name || '档案科 · 值班撰写员') + '</div>' +
          '<div class="date">' + M.esc(r.date || '—') + '</div>' +
          '<div class="hint">点击以盖章</div>' +
          '<div class="stamp">' + M.esc(r.stamp || ['撰', '校', '准'][i % 3]) + '</div></div>';
      }).join('') + '</div>' +
      '<p class="rv" style="margin-top:18px;font-size:12.5px;color:var(--ink-3)">' + M.rich(note) + '</p>';
    },

    init: function (root, data) {
      data = data || {};
      var rows = Array.isArray(data.rows) && data.rows.length ? data.rows.filter(Boolean) : defaults();
      var cells = Array.prototype.slice.call(root.querySelectorAll('.sign-flow > div'));
      var signed = cells.map(function () { return false; });

      function toast(msg, bad) {
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.toggle('bad', !!bad);
        t.classList.add('is-on');
        setTimeout(function () { t.classList.remove('is-on'); }, 2400);
      }

      function apply(i, anim) {
        var c = cells[i], st = c.querySelector('.stamp');
        c.classList.toggle('is-signed', signed[i]);
        if (!st) return;
        st.style.setProperty('--r', (i % 2 ? 7 : -9) + 'deg');
        if (signed[i]) {
          st.classList.remove('is-down');
          if (anim) void st.offsetWidth;
          st.classList.add('is-down');
        } else {
          st.classList.remove('is-down');
        }
      }

      cells.forEach(function (c, i) {
        apply(i, false);
        c.addEventListener('click', function () {
          var need = +(rows[i] && rows[i].need) || 1;
          var lv = window.__CX_GET_CLEARANCE__ ? window.__CX_GET_CLEARANCE__() : 3;
          if (!signed[i] && i > 0 && !signed[i - 1]) { toast('须按顺序签批：请先完成上一道签章。', true); return; }
          if (!signed[i] && lv < need) { toast('该签章需要 L' + need + ' 权限。', true); return; }
          if (signed[i] && signed[i + 1]) { toast('后续签章已完成，无法撤回本章。', true); return; }
          signed[i] = !signed[i];
          apply(i, true);
          if (signed.every(Boolean)) toast('签批完成。本档案正式生效。');
        });
        c.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
        });
      });
    }
  });
})();
