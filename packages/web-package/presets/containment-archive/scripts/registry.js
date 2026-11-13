/* 存续院收容部 · 模块注册表与渲染工具
   各模块文件只调用 CXModule.register；本文件不预加载任何模块。 */
(function (global) {
  'use strict';

  var registry = Object.create(null);

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* 把 [[密文|4]] 转为权限黑条，其余文本全部转义。 */
  function rich(value) {
    return esc(value).replace(/\[\[([\s\S]*?)\|([1-5])\]\]/g, function (_m, text, lv) {
      return '<span class="rd" data-lv="' + lv + '">' + text + '</span>';
    });
  }

  function paras(list, cls) {
    if (!Array.isArray(list)) return '';
    return list.filter(function (item) { return typeof item === 'string' && item.trim(); })
      .map(function (item) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + rich(item) + '</p>'; })
      .join('');
  }

  function text(value, fallback) {
    var out = typeof value === 'string' ? value.trim() : '';
    return out || (fallback == null ? '' : fallback);
  }

  /* 山海八级：每级一只形制不同的神兽线稿。全部内联，无外部图片或字体依赖。
     画布统一 240×300，主轮廓线宽 1.5，细节 0.9，保证同一张卡片里的视觉重心一致。 */
  var BEASTS = {
    '无': {
      cap: '无 · 此处无物可摹',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">' +
        '<path d="M48 54 H192 V246 H48 Z" opacity=".45"/>' +
        '<path d="M56 62 V238 H184 V62" opacity=".22"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round">' +
        '<ellipse cx="120" cy="148" rx="52" ry="66" opacity=".18"/>' +
        '<circle cx="120" cy="148" r="44" stroke-dasharray="2 7" opacity=".25"/>' +
        '<path d="M62 214 Q78 204 94 214 M146 214 Q162 204 178 214" opacity=".35"/>' +
        '<text x="120" y="170" text-anchor="middle" font-size="56" letter-spacing="6" fill="currentColor" stroke="none" opacity=".13" font-family="KaiTi,STKaiti,serif">无</text>' +
        '</g>'
    },
    '乘黄': {
      cap: '乘黄 · 背角如弧，乘之寿千岁',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M58 166 Q50 144 70 136 Q104 126 138 130 Q166 134 176 150 Q184 164 170 172 Q144 180 108 178 Q78 176 58 166 Z"/>' +
        '<path d="M166 136 Q176 114 192 106 Q204 100 212 108 Q218 116 210 124 Q200 132 192 140"/>' +
        '<path d="M194 107 L190 92 L202 99"/>' +
        '<path d="M208 116 Q214 120 212 125"/>' +
        '<path d="M146 130 Q158 102 178 90 Q190 82 198 88"/>' +
        '<path d="M170 156 Q176 182 172 206 M86 174 Q82 200 88 222 M136 176 Q134 202 140 224 M104 176 Q102 200 108 220"/>' +
        '<path d="M172 206 L182 209 M88 222 L76 226 M140 224 L150 228 M108 220 L98 224"/>' +
        '<path d="M60 158 Q42 150 36 130 Q32 116 42 108"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M172 134 L163 122 M180 130 L171 118 M188 126 L180 115"/>' +
        '<path d="M36 234 Q52 226 68 234 M92 242 Q108 234 124 242 M148 234 Q164 226 180 234 M202 242 Q212 236 222 242"/>' +
        '<circle cx="204" cy="114" r="1.6" fill="currentColor" stroke="none"/>' +
        '</g>'
    },
    '夔': {
      cap: '夔 · 独足雷兽，摹自西塔三层的接触记录',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M54 100 Q42 76 30 52 Q26 56 34 60 Q50 82 66 98 Z"/>' +
        '<path d="M84 108 Q72 98 58 100 Q42 103 35 114 Q29 126 39 135 Q50 143 66 140 Q80 136 86 124 Z"/>' +
        '<path d="M35 114 Q22 117 22 126 Q24 135 36 134"/>' +
        '<path d="M80 104 Q84 96 91 100 Q88 106 82 108"/>' +
        '<path d="M86 122 Q92 132 100 138"/>' +
        '<path d="M94 126 Q112 114 138 116 Q162 118 174 128 Q184 138 184 150 Q186 172 158 182 Q126 190 100 178 Q86 166 88 148 Q90 134 94 126 Z"/>' +
        '<path d="M112 186 Q106 206 112 226 L136 226 Q142 204 138 186"/>' +
        '<path d="M112 226 L112 242 Q128 248 144 242 L144 226"/>' +
        '<path d="M186 148 Q206 142 214 124 Q218 114 210 108"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M98 124 Q132 114 170 126 Q180 132 184 144" stroke-dasharray="6 5"/>' +
        '<path d="M100 136 Q118 126 140 130"/>' +
        '<path d="M96 168 Q126 182 162 176"/>' +
        '<path d="M152 186 Q158 204 154 222" opacity=".35"/>' +
        '<circle cx="48" cy="120" r="1.6" fill="currentColor" stroke="none"/>' +
        '<circle cx="29" cy="127" r="1" fill="currentColor" stroke="none"/>' +
        '<path d="M32 129 Q40 132 46 130"/>' +
        '<path d="M60 100 Q46 78 32 54" opacity=".4"/>' +
        '<circle cx="208" cy="198" r="16"/>' +
        '<path d="M192 198 H224 M208 182 V214"/>' +
        '<path d="M199 190 Q208 198 199 206 Q208 213 217 206"/>' +
        '</g>'
    },
    '相柳': {
      cap: '相柳 · 九首蛇身，摹自洪泽北岸的目击口述',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M44 238 Q38 210 80 199 Q120 189 160 199 Q200 210 196 238"/>' +
        '<path d="M62 248 Q58 226 94 216 Q126 207 158 216 Q188 226 184 248"/>' +
        '<path d="M80 256 Q78 238 106 230 Q132 222 156 230 Q178 238 176 256"/>' +
        '<path d="M110 205 Q94 170 70 142"/>' +
        '<path d="M116 205 Q110 166 106 128"/>' +
        '<path d="M124 205 Q134 168 152 138"/>' +
        '<path d="M106 203 Q84 178 52 162"/>' +
        '<path d="M132 203 Q154 180 182 170"/>' +
        '<path d="M114 202 Q98 152 90 98"/>' +
        '<path d="M126 202 Q144 154 156 98"/>' +
        '<path d="M104 202 Q70 192 40 198"/>' +
        '<path d="M136 202 Q170 192 200 200"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M70 142 Q62 132 72 126 Q82 122 84 132 Q82 140 74 145 Z"/>' +
        '<path d="M106 128 Q100 114 110 108 Q120 104 121 114 Q120 124 112 130 Z"/>' +
        '<path d="M152 138 Q156 124 168 122 Q178 124 174 136 Q168 144 158 144 Z"/>' +
        '<path d="M52 162 Q40 158 38 148 Q42 140 52 142 Q58 148 56 158 Z"/>' +
        '<path d="M182 170 Q192 164 200 168 Q204 178 194 182 Q186 182 182 176 Z"/>' +
        '<path d="M90 98 Q84 84 94 78 Q104 76 104 86 Q102 96 94 102 Z"/>' +
        '<path d="M156 98 Q160 84 170 82 Q180 82 176 94 Q170 102 160 104 Z"/>' +
        '<path d="M40 198 Q28 194 26 184 Q30 176 40 180 Q46 186 44 196 Z"/>' +
        '<path d="M200 200 Q212 194 220 200 Q222 210 212 212 Q204 212 200 206 Z"/>' +
        '<path d="M74 145 L66 150 M112 130 L105 137 M158 144 L166 151 M56 158 L47 164 M182 176 L190 184 M94 102 L86 108 M160 104 L168 110 M44 196 L35 202 M200 206 L210 214"/>' +
        '<path d="M96 224 Q104 218 112 224 M128 214 Q136 208 144 214 M86 236 Q94 230 102 236 M150 228 Q158 222 166 228"/>' +
        '<circle cx="76" cy="137" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="112" cy="119" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="168" cy="132" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="46" cy="152" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="193" cy="174" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="96" cy="90" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="168" cy="92" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="34" cy="188" r="1.3" fill="currentColor" stroke="none"/>' +
        '<circle cx="210" cy="204" r="1.3" fill="currentColor" stroke="none"/>' +
        '</g>'
    },
    '女娲': {
      cap: '女娲 · 人首蛇身，持规而立',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M108 58 Q122 56 130 68 Q136 82 128 92 Q118 100 108 94 Q100 84 100 72 Q102 60 108 58 Z"/>' +
        '<path d="M100 72 Q100 58 114 52 Q130 48 136 60 Q138 66 134 70"/>' +
        '<path d="M112 50 Q118 42 128 46 Q132 50 128 54"/>' +
        '<path d="M118 96 L118 108 M128 92 L128 108"/>' +
        '<path d="M118 108 Q100 110 92 122 Q88 130 90 138"/>' +
        '<path d="M128 108 Q148 110 156 122 Q160 130 158 138"/>' +
        '<path d="M94 124 Q124 118 154 124"/>' +
        '<path d="M90 138 Q84 156 92 172 Q94 176 90 178"/>' +
        '<path d="M158 138 Q164 156 156 172 Q154 176 158 178"/>' +
        '<path d="M90 178 Q120 188 158 178"/>' +
        '<path d="M92 122 Q78 142 82 160 Q84 168 88 174"/>' +
        '<path d="M156 122 Q168 132 178 137"/>' +
        '<path d="M122 184 Q114 198 100 208 Q80 224 70 240 Q60 256 72 266 Q86 274 96 262 Q104 250 92 244 Q82 240 78 252"/>' +
        '<path d="M182 140 L178 186 M182 140 L214 182"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M115 70 Q121 68 126 71"/>' +
        '<circle cx="122" cy="75" r="1.4" fill="currentColor" stroke="none"/>' +
        '<path d="M126 78 Q130 82 127 84"/>' +
        '<path d="M118 86 Q124 88 128 85"/>' +
        '<path d="M100 132 Q124 142 148 132" opacity=".4"/>' +
        '<path d="M94 164 Q124 170 154 164" opacity=".35"/>' +
        '<circle cx="182" cy="140" r="2" fill="currentColor" stroke="none"/>' +
        '<path d="M172 166 Q184 170 196 164"/>' +
        '<path d="M178 186 L175 190 M214 182 L217 185"/>' +
        '<path d="M178 146 Q180 142 182 139"/>' +
        '<path d="M120 190 Q108 202 94 214" opacity=".35"/>' +
        '<path d="M110 196 Q116 192 122 196 M98 206 Q104 201 110 206 M86 220 Q92 215 98 220 M76 238 Q82 233 88 238 M82 260 Q88 256 94 260"/>' +
        '</g>'
    },
    '息壤': {
      cap: '息壤 · 自长之土，取一抔而封',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M52 250 Q40 230 56 214 Q44 196 62 182 Q58 160 80 148 Q94 138 120 138 Q146 138 160 148 Q182 160 178 182 Q196 196 184 214 Q200 230 188 250 Z"/>' +
        '<path d="M60 216 Q90 206 120 210 Q150 214 180 206"/>' +
        '<path d="M54 236 Q90 224 124 230 Q158 236 186 226"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M92 138 Q94 126 100 120 M100 138 Q104 124 112 122 M116 136 Q120 124 128 122 M136 138 Q140 128 146 126"/>' +
        '<path d="M56 214 Q46 210 42 216 M184 214 Q194 210 198 216"/>' +
        '<path d="M206 160 Q212 156 210 150 M214 178 Q220 176 218 170"/>' +
        '<circle cx="70" cy="196" r="1.2" fill="currentColor" stroke="none"/>' +
        '<circle cx="96" cy="168" r="1" fill="currentColor" stroke="none"/>' +
        '<circle cx="170" cy="190" r="1.2" fill="currentColor" stroke="none"/>' +
        '<circle cx="150" cy="226" r="1" fill="currentColor" stroke="none"/>' +
        '</g>'
    },
    '共工': {
      cap: '共工 · 双角怒相，浪随水起',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M96 96 Q96 76 110 68 Q124 62 136 72 Q142 78 142 90 Q142 104 132 110 Q118 118 104 110 Q96 104 96 96 Z"/>' +
        '<path d="M106 66 L90 44 L102 48 L112 64"/>' +
        '<path d="M130 66 L146 46 L134 48 L124 64"/>' +
        '<path d="M140 82 Q148 86 146 94 Q152 96 148 100"/>' +
        '<path d="M104 112 L96 132 Q78 136 64 152"/>' +
        '<path d="M134 112 L144 130 Q162 134 176 150"/>' +
        '<path d="M84 150 Q76 180 86 204 M156 148 Q166 178 158 202"/>' +
        '<path d="M70 210 Q120 198 176 210"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M176 120 Q206 122 214 148 Q220 172 206 190 Q192 206 174 200"/>' +
        '<path d="M34 142 Q56 128 78 136"/>' +
        '<path d="M196 176 Q204 168 212 176 Q218 184 210 190 Q202 194 198 186"/>' +
        '<path d="M28 224 Q44 216 60 224 M76 232 Q92 224 108 232 M124 238 Q140 230 156 238 M172 232 Q188 224 204 232"/>' +
        '<circle cx="128" cy="88" r="1.6" fill="currentColor" stroke="none"/>' +
        '</g>'
    },
    '建木': {
      cap: '建木 · 通天神木，其高无顶',
      body:
        '<g class="beast" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M112 268 Q110 220 112 180 Q114 140 112 100 Q110 60 112 8"/>' +
        '<path d="M132 268 Q134 220 132 180 Q130 140 132 100 Q134 60 132 8"/>' +
        '<path d="M112 120 Q72 112 36 88 M132 120 Q176 112 212 92"/>' +
        '<path d="M112 168 Q80 164 48 146 M132 168 Q164 164 196 148"/>' +
        '<path d="M112 84 Q84 76 60 52 M132 84 Q162 78 188 58"/>' +
        '<path d="M112 250 Q88 258 62 268 M132 250 Q158 258 184 268"/>' +
        '<path d="M112 240 Q100 248 88 254 M132 240 Q146 248 158 254"/>' +
        '</g>' +
        '<g class="beast-detail" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".55">' +
        '<path d="M121 36 V204"/>' +
        '<path d="M116 66 H126 M116 98 H126 M116 130 H126 M116 160 H126"/>' +
        '<path d="M60 96 Q66 90 72 94 M176 98 Q182 92 188 96 M52 154 Q60 148 68 152"/>' +
        '<path d="M92 46 Q96 40 102 42 M144 50 Q150 44 156 48"/>' +
        '</g>'
    }
  };

  function beastKey(beast) {
    return Object.prototype.hasOwnProperty.call(BEASTS, beast) ? beast : '无';
  }

  function beastCaption(beast) {
    return BEASTS[beastKey(beast)].cap;
  }

  /* 山海图志神兽摹写：按八级取不同兽形，图注语义由 HTML 承载。 */
  function beastSvg(beast) {
    var key = beastKey(beast);
    var label = key === '无' ? '未定形 · 摹写' : key + ' · 摹写';
    return '<svg viewBox="0 0 240 300" aria-hidden="true" preserveAspectRatio="xMidYMid meet" data-shape="' + esc(key) + '">' +
      BEASTS[key].body +
      '<g class="beast-mark" fill="none" stroke="currentColor" stroke-width=".7" opacity=".35">' +
      '<path d="M26 264 H214 M26 260 V268 M214 260 V268"/></g>' +
      '<text class="beast-label" x="120" y="286" text-anchor="middle" font-size="9" fill="currentColor" opacity=".55" letter-spacing="2" stroke="none">' +
      esc(label) + '</text>' +
      '</svg>';
  }

  var api = {
    register: function (def) {
      if (!def || typeof def.id !== 'string' || typeof def.render !== 'function') return;
      registry[def.id] = def;
    },
    get: function (id) { return registry[id] || null; },
    has: function (id) { return !!registry[id]; },
    ids: function () { return Object.keys(registry); },
    esc: esc,
    rich: rich,
    paras: paras,
    text: text,
    beastSvg: beastSvg,
    beastCaption: beastCaption,
    nl2br: function (value) { return rich(value).replace(/\n/g, '<br>'); }
  };

  global.CXModule = api;
})(window);
