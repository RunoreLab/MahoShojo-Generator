/* 存续院收容部 · Web 包运行时
   职责：读取 data/archive.json → 渲染三节基础内容 → 按 modules 声明装配附录。
   未声明或未知的模块不产生任何 DOM。 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = window.CXModule.esc;
  var rich = window.CXModule.rich;
  var paras = window.CXModule.paras;

  var CN = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾', '拾壹', '拾贰', '拾叁', '拾肆', '拾伍', '拾陆'];
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var GRADES = [
    { key: 'none', alias: ['无', 'NULL', ''], name: '无', en: 'NULL', c: '#7a7f7c' },
    { key: 'ch', alias: ['乘黄', 'CHENGHUANG'], name: '乘黄', en: 'CHENGHUANG', c: '#b8902e' },
    { key: 'kui', alias: ['夔', 'KUI'], name: '夔', en: 'KUI', c: '#3f7f95' },
    { key: 'xl', alias: ['相柳', 'XIANGLIU'], name: '相柳', en: 'XIANGLIU', c: '#6a8a2c' },
    { key: 'nw', alias: ['女娲', 'NUWA'], name: '女娲', en: 'NUWA', c: '#c2603f' },
    { key: 'xr', alias: ['息壤', 'XIRANG'], name: '息壤', en: 'XIRANG', c: '#8a6236' },
    { key: 'gg', alias: ['共工', 'GONGGONG'], name: '共工', en: 'GONGGONG', c: '#a8281e' },
    { key: 'jm', alias: ['建木', 'JIANMU'], name: '建木', en: 'JIANMU', c: '#2f8a62' }
  ];

  var state = {
    clearance: 3,
    radar: { axes: ['危险性', '扩散性', '智能', '隐蔽性', '可交流', '收容难度'], vals: [3, 2, 4, 3, 2, 3] },
    hume: { base: 100 },
    mounted: [],
    ignored: [],
    failed: [],
    empty: [],
    unmounted: [],
    declared: [],
    structureUsed: false,
    normalized: [],
    diagnostics: null,
    rail: []
  };

  /* ==================== 基础工具 ==================== */

  var toastTimer;
  function toast(msg, bad) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2400);
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setText(id, value) {
    var el = $('#' + id);
    if (el) el.textContent = value == null || value === '' ? '—' : value;
  }

  /* ==================== 运行时归一化（宽进） ==================== */
  /* AI 常见偏差：大小写、缩写、单值写成数组、字段别名、grade/clearance 写“四级/L4/4”、
     modules 写成对象数组、description 直接写数组、moduleData 缺模块、structure 缺失。
     这里把能修的偏差修成内部规范形态，并记录到 state.normalized；修不了的留给装配层跳过。 */

  var DEF_AXES = ['危险性', '扩散性', '智能', '隐蔽性', '可交流', '收容难度'];
  var GRADE_NAMES = ['无', '乘黄', '夔', '相柳', '女娲', '息壤', '共工', '建木'];

  var MODULE_ALIAS = {
    interview: ['interview', '访谈', '访谈记录', '口供', '采访', '问答', '问询'],
    log: ['log', 'logs', 'video', 'surveillance', 'cctv', '监控', '监控录像', '录像', '监控记录'],
    timeline: ['timeline', 'events', '时间轴', '事件时间轴', '大事记'],
    photo: ['photo', 'photos', 'image', 'images', 'picture', 'pictures', '影像', '影像资料', '照片'],
    letter: ['letter', 'letters', 'correspondence', '信件', '封存信件', '信', '遗书'],
    sandbox: ['sandbox', 'memetic', '沙箱', '沙箱模拟', '模因', '污染文本'],
    map: ['map', 'site', '地点', '舆图', '地点舆图', '地图', '平面图'],
    list: ['list', 'inventory', '清单', '清单物证', '物证', '库存'],
    report: ['report', 'actionreport', '报告', '行动报告', '处置报告'],
    atlas: ['atlas', 'bestiary', 'beastiary', '山海图志', '图志', '异兽图', '异种图'],
    sign: ['sign', 'signature', 'signatures', '签批', '签章', '签批流程']
  };

  var SECTION_ALIAS = {
    containment: ['containment', 'contain', '收容', '收容措施', '特殊收容措施'],
    description: ['description', 'desc', '描述', '项目描述'],
    monitoring: ['monitoring', 'monitor', '监测', '监测数据'],
    note: ['note', '过渡段', 'transit'],
    sign: ['sign', 'signature', '签批', '签章']
  };

  var ALIAS_LOOKUP = {};
  (function () {
    var groups = [MODULE_ALIAS, SECTION_ALIAS];
    groups.forEach(function (group) {
      Object.keys(group).forEach(function (id) {
        group[id].forEach(function (a) {
          ALIAS_LOOKUP[String(a).toLowerCase().replace(/\s+/g, '')] = id;
        });
      });
    });
  })();

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function toArr(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }
  function clampNum(v, min, max) { return Math.max(min, Math.min(max, num(v, min))); }

  /* 把任意标量/对象/数组压成一段可显示文字。 */
  function asStr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(asStr).filter(Boolean).join(' ');
    if (isObj(v)) {
      return asStr(v.text != null ? v.text : (v.content != null ? v.content : (v.body != null ? v.body :
        (v.name != null ? v.name : (v.title != null ? v.title : (v.value != null ? v.value : ''))))));
    }
    return '';
  }

  /* 单段文本按换行拆分；保留段落内部的分号与句号。 */
  function splitList(text) {
    return String(text == null ? '' : text).split(/\r?\n/).map(function (line) {
      return line.replace(/^\s*(?:[-*•·]|\d+[.、)）])\s*/, '').trim();
    }).filter(Boolean);
  }

  function splitNumbers(text) {
    return String(text == null ? '' : text).split(/[,，、/|]+/).map(function (x) {
      return parseFloat(String(x).replace(/[^0-9.\-]/g, ''));
    }).filter(function (x) { return isFinite(x); });
  }

  function normTypeCode(v) {
    var s = asStr(v).trim().toLowerCase();
    if (!s) return 'P';
    if (/^b|异种|生物|beast|bio/.test(s)) return 'B';
    if (/^m|模因|memetic|meme/.test(s)) return 'M';
    if (/^i|物品|物件|item|object/.test(s)) return 'I';
    if (/^s|空间|地点|site|space/.test(s)) return 'S';
    if (/^p|人形|person/.test(s)) return 'P';
    return 'P';
  }

  function cnNum(v) {
    var s = String(v == null ? '' : v);
    var n = parseInt(s.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n)) return n;
    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    var m = /[一二三四五六七八九十]/.exec(s);
    return m ? map[m[0]] : NaN;
  }

  function normGrade(v) {
    var raw = asStr(v).trim();
    if (!raw) return '无';
    var upper = raw.toUpperCase();
    for (var i = 0; i < GRADES.length; i++) {
      if (GRADES[i].alias.some(function (a) { return a.toUpperCase() === upper; })) return GRADES[i].name;
    }
    var n = cnNum(raw);
    if (!isNaN(n) && n >= 1 && n <= 8) return GRADE_NAMES[n - 1];
    return raw;
  }

  function normClearance(v) {
    var raw = asStr(v).trim().toUpperCase();
    if (/^L[1-5]$/.test(raw)) return raw;
    var n = cnNum(raw);
    if (!isNaN(n) && n >= 1 && n <= 5) return 'L' + n;
    return 'L3';
  }

  function normJudge(v) {
    if (v === true) return 'wt';
    if (v === false) return 'ok';
    var s = asStr(v).trim().toLowerCase();
    if (/^(ok|正常|正常值|合格|稳定|stable|pass|good|通过)$/.test(s)) return 'ok';
    if (/^(wt|观察|关注|watch|warn|warning|注意|待定|存疑)$/.test(s)) return 'wt';
    if (/^(ng|异常|不合格|危险|fail|error|bad|alert|失控)$/.test(s)) return 'ng';
    return 'ok';
  }

    function normBool(v) {
      if (v === true || v === 1) return true;
      var s = asStr(v).trim().toLowerCase();
      return /^(true|yes|1|是|重要|关键|critical|major)$/.test(s);
    }

  function normModuleId(v) {
    var raw = asStr(v).trim();
    if (!raw) return '';
    var key = raw.toLowerCase().replace(/\s+/g, '');
    if (ALIAS_LOOKUP[key]) return ALIAS_LOOKUP[key];
    var m = /(?:modules\/)?([a-z][a-z0-9_-]*)(?:\.js)?$/.exec(key);
    return m ? m[1] : key;
  }

  function normSpecItem(s) {
    if (typeof s === 'string') return { label: s, value: '—', ratio: 50 };
    if (!isObj(s)) return null;
    var label = asStr(s.label != null ? s.label : (s.name != null ? s.name : s.key));
    var value = s.value != null ? s.value : (s.val != null ? s.val : (s.reading != null ? s.reading : '—'));
    return { label: label, value: asStr(value), ratio: clampNum(s.ratio != null ? s.ratio : s.percent, 0, 100) };
  }

  function normSpecs(v) {
    if (v == null) return [];
    if (isObj(v) && !Array.isArray(v)) {
      if (v.label != null || v.value != null || v.name != null) return [normSpecItem(v)];
      return Object.keys(v).map(function (k) { return normSpecItem(isObj(v[k]) ? v[k] : { label: k, value: v[k] }); });
    }
    return toArr(v).map(normSpecItem).filter(function (x) { return x && x.label; });
  }

  function normSupplies(v) {
    if (v == null) return [];
    if (isObj(v) && !Array.isArray(v)) {
      if (v.name != null || v.qty != null) return [normSupply(v)];
      return Object.keys(v).map(function (k) { return { name: k, qty: asStr(v[k]) || '按需' }; });
    }
    return toArr(v).map(normSupply).filter(function (x) { return x && x.name; });
  }

  function normSupply(s) {
    if (typeof s === 'string') return { name: s, qty: '按需' };
    if (!isObj(s)) return null;
    return {
      name: asStr(s.name != null ? s.name : (s.title != null ? s.title : s.item)),
      qty: s.qty != null ? asStr(s.qty) : (s.quantity != null ? asStr(s.quantity) : '按需')
    };
  }

  function normEmergency(v) {
    if (v == null) return [];
    var list;
    if (isObj(v) && !Array.isArray(v)) {
      if (v.title != null || v.level != null || v.steps != null) list = [v];
      else list = Object.keys(v).map(function (k) {
        return isObj(v[k]) ? v[k] : { title: k, body: asStr(v[k]) };
      });
    } else list = toArr(v);
    return list.map(function (e, i) {
      if (typeof e === 'string') return { level: '第' + (i + 1) + '级', title: '应急协议', body: e, steps: [] };
      if (!isObj(e)) return null;
      return {
        level: asStr(e.level != null ? e.level : ('第' + (i + 1) + '级')),
        title: asStr(e.title != null ? e.title : (e.name != null ? e.name : '应急协议')),
        body: asStr(e.body != null ? e.body : (e.content != null ? e.content : e.text)),
        steps: toArr(e.steps != null ? e.steps : (e.actions != null ? e.actions : e.list)).map(asStr).filter(Boolean),
        color: e.color
      };
    }).filter(Boolean);
  }

  function normTaboo(v) {
    if (v == null) return [];
    var list;
    if (isObj(v) && !Array.isArray(v)) {
      if (v.title != null || v.text != null) list = [v];
      else list = Object.keys(v).map(function (k) { return { title: k, text: asStr(v[k]) }; });
    } else list = toArr(v);
    return list.map(function (t) {
      if (typeof t === 'string') return { title: '禁忌', text: t };
      if (!isObj(t)) return null;
      return {
        title: asStr(t.title != null ? t.title : (t.name != null ? t.name : '禁忌')),
        text: asStr(t.text != null ? t.text : (t.body != null ? t.body : (t.content != null ? t.content : t.desc)))
      };
    }).filter(function (t) { return t && t.text; });
  }

  function normTabs(v) {
    if (v == null) return [];
    var raw;
    if (isObj(v) && !Array.isArray(v)) {
      if (v.label != null || v.body != null || v.title != null) raw = [v];
      else raw = Object.keys(v).map(function (k) { return { label: k, body: v[k] }; });
    } else raw = toArr(v);
    return raw.map(function (t, i) {
      if (typeof t === 'string') return { label: '页 ' + (i + 1), body: t };
      if (!isObj(t)) return null;
      return {
        label: asStr(t.label != null ? t.label : (t.title != null ? t.title : (t.name != null ? t.name : ('页 ' + (i + 1))))),
        body: asStr(t.body != null ? t.body : (t.content != null ? t.content : t.text))
      };
    }).filter(function (t) { return t && t.body; });
  }

  function normAtlas(v) {
    if (v == null) return null;
    var a = Array.isArray(v) ? { text: v } : (typeof v === 'string' ? { text: [v] } : (isObj(v) ? v : null));
    if (!a) return null;
    var body = a.text != null ? a.text : (a.body != null ? a.body : (a.content != null ? a.content : a.paras));
    var text = typeof body === 'string' ? splitList(body) : toArr(body).map(asStr).filter(Boolean);
    var beast = a.beast != null ? a.beast : (a.beastName != null ? a.beastName : (a.animal != null ? a.animal : a.gradeName));
    return {
      title: asStr(a.title != null ? a.title : (a.name != null ? a.name : '山海图志')),
      text: text,
      caption: asStr(a.caption),
      beast: asStr(beast),
      grade: a.grade != null ? a.grade : (a.level != null ? a.level : a.gradeName)
    };
  }

  function normInterview(v) {
    if (typeof v === 'string') return { lines: splitList(v).map(function (s) { return { a: s }; }) };
    if (Array.isArray(v)) return { lines: v };
    if (!isObj(v)) return {};
    var o = v;
    var lines = o.lines != null ? o.lines : (o.dialogue != null ? o.dialogue : (o.qa != null ? o.qa : o.entries));
    if (lines !== undefined && o.lines !== lines) { o.lines = lines; }
    if (typeof lines === 'string') o.lines = splitList(lines).map(function (s) { return { a: s }; });
    else if (isObj(lines) && !Array.isArray(lines)) o.lines = Object.keys(lines).map(function (k) { return { q: k, a: asStr(lines[k]) }; });
    else if (!Array.isArray(lines)) o.lines = lines != null ? [lines] : [];
    o.lines = o.lines.map(function (ln) {
      if (typeof ln === 'string') return { a: ln };
      if (!isObj(ln)) return null;
      return {
        q: asStr(ln.q != null ? ln.q : (ln.question != null ? ln.question : ln.ask)),
        a: asStr(ln.a != null ? ln.a : (ln.answer != null ? ln.answer : (ln.response != null ? ln.response : (ln.content != null ? ln.content : ln.text)))),
        note: asStr(ln.note != null ? ln.note : (ln.remark != null ? ln.remark : ln.comment))
      };
    }).filter(Boolean);
    o.title = asStr(o.title != null ? o.title : (o.name != null ? o.name : '访谈记录'));
    o.subject = asStr(o.subject != null ? o.subject : (o.interviewee != null ? o.interviewee : o.person));
    o.interviewer = asStr(o.interviewer != null ? o.interviewer : (o.interviewerName != null ? o.interviewerName : o.op));
    o.preamble = asStr(o.preamble != null ? o.preamble : o.intro);
    o.after = asStr(o.after != null ? o.after : (o.conclusion != null ? o.conclusion : o.postscript));
    return o;
  }

  function parseSec(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v);
    var m = s.match(/(\d+):(\d+):(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    m = s.match(/(\d+):(\d+)/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? +m[1] : 0;
  }

  function normLog(v) {
    if (typeof v === 'string') return { entries: splitList(v).map(function (s, i) { return { t: i * 5, v: s }; }) };
    if (Array.isArray(v)) return { entries: v };
    if (!isObj(v)) return {};
    var o = v;
    var entries = o.entries != null ? o.entries : (o.frames != null ? o.frames : (o.records != null ? o.records : o.events));
    if (entries !== undefined && o.entries !== entries) o.entries = entries;
    if (typeof entries === 'string') o.entries = splitList(entries).map(function (s, i) { return { t: i * 5, v: s }; });
    else if (isObj(entries) && !Array.isArray(entries)) o.entries = Object.keys(entries).map(function (k) { return { t: parseSec(k), v: asStr(entries[k]) }; });
    else if (!Array.isArray(entries)) o.entries = entries != null ? [entries] : [];
    o.entries = o.entries.map(function (e, i) {
      if (typeof e === 'string') return { t: i * 5, v: e };
      if (!isObj(e)) return null;
      var tRaw = e.t != null ? e.t : (e.time != null ? e.time : (e.at != null ? e.at : e.sec));
      return {
        t: tRaw != null ? parseSec(tRaw) : i * 5,
        v: asStr(e.v != null ? e.v : (e.text != null ? e.text : (e.content != null ? e.content : (e.msg != null ? e.msg : e.description)))),
        cap: asStr(e.cap != null ? e.cap : (e.caption != null ? e.caption : (e.detail != null ? e.detail : e.note)))
      };
    }).filter(function (e) { return e && e.v; });
    o.title = asStr(o.title != null ? o.title : (o.name != null ? o.name : '监控录像'));
    o.cam = asStr(o.cam != null ? o.cam : o.camera);
    o.site = asStr(o.site != null ? o.site : o.location);
    o.date = asStr(o.date != null ? o.date : o.time);
    o.duration = o.duration != null ? parseSec(o.duration) : null;
    return o;
  }

  function normTimeline(v) {
    if (typeof v === 'string') return { events: splitList(v).map(function (s) { return { title: s }; }) };
    if (Array.isArray(v)) return { events: v };
    if (!isObj(v)) return {};
    var o = v;
    var events = o.events != null ? o.events : (o.items != null ? o.items : (o.records != null ? o.records : o.timeline));
    if (events !== undefined && o.events !== events) o.events = events;
    if (typeof events === 'string') o.events = splitList(events).map(function (s) { return { title: s }; });
    else if (isObj(events) && !Array.isArray(events)) o.events = Object.keys(events).map(function (k) { return { date: k, title: asStr(events[k]) }; });
    else if (!Array.isArray(events)) o.events = events != null ? [events] : [];
    o.events = o.events.map(function (e, i) {
      if (typeof e === 'string') return { date: '—', title: e };
      if (!isObj(e)) return null;
      return {
        date: asStr(e.date != null ? e.date : (e.time != null ? e.time : (e.when != null ? e.when : e.day))) || '—',
        title: asStr(e.title != null ? e.title : (e.name != null ? e.name : (e.event != null ? e.event : e.label))) || ('事件 ' + (i + 1)),
        text: asStr(e.text != null ? e.text : (e.content != null ? e.content : (e.description != null ? e.description : (e.desc != null ? e.desc : e.detail)))),
        crit: normBool(e.crit != null ? e.crit : (e.critical != null ? e.critical : e.important))
      };
    }).filter(Boolean);
    return o;
  }

  function normArt(v) {
    var s = asStr(v).toLowerCase().trim();
    if (/corridor|走廊|监控|通道/.test(s)) return 'corridor';
    if (/object|物件|物品|遗物|道具/.test(s)) return 'object';
    if (/document|文件|文档|纸|档案/.test(s)) return 'document';
    if (/exterior|外景|建筑|户外|地点/.test(s)) return 'exterior';
    return 'corridor';
  }

  function normPhoto(v) {
    if (typeof v === 'string') return { items: [{ art: 'document', cap: v, no: '1' }] };
    if (Array.isArray(v)) return { items: v };
    if (!isObj(v)) return {};
    var o = v;
    o.items = toArr(o.items != null ? o.items : (o.photos != null ? o.photos : (o.images != null ? o.images : o.pictures)));
    o.items = o.items.map(function (it, i) {
      if (typeof it === 'string') return { art: 'document', cap: it, no: String(i + 1) };
      if (!isObj(it)) return null;
      return {
        art: normArt(it.art != null ? it.art : (it.type != null ? it.type : it.kind)),
        cap: asStr(it.cap != null ? it.cap : (it.caption != null ? it.caption : (it.title != null ? it.title : it.name))) || ('影像 ' + (i + 1)),
        no: asStr(it.no != null ? it.no : (it.id != null ? it.id : (it.number != null ? it.number : String(i + 1)))),
        note: asStr(it.note != null ? it.note : (it.desc != null ? it.desc : (it.description != null ? it.description : it.text))),
        rotate: it.rotate != null ? num(it.rotate, 0) : null
      };
    }).filter(Boolean);
    o.note = asStr(o.note != null ? o.note : o.description);
    return o;
  }

  function normLetter(v) {
    if (typeof v === 'string') return { body: splitList(v) };
    if (Array.isArray(v)) return { body: v };
    if (!isObj(v)) return {};
    var o = v;
    var body = o.body != null ? o.body : (o.content != null ? o.content : (o.text != null ? o.text : (o.paras != null ? o.paras : o.lines)));
    if (typeof body === 'string') body = splitList(body);
    else if (!Array.isArray(body)) body = body != null ? [body] : [];
    o.body = body.map(asStr).filter(Boolean);
    o.label = asStr(o.label != null ? o.label : (o.title != null ? o.title : o.name));
    o.sign = asStr(o.sign != null ? o.sign : (o.signature != null ? o.signature : (o.from != null ? o.from : o.author)));
    o.date = asStr(o.date != null ? o.date : o.time);
    return o;
  }

  function normSandbox(v) {
    if (typeof v === 'string') return { body: splitList(v) };
    if (Array.isArray(v)) return { body: v };
    if (!isObj(v)) return {};
    var o = v;
    var body = o.body != null ? o.body : (o.content != null ? o.content : (o.text != null ? o.text : o.paras));
    if (typeof body === 'string') body = splitList(body);
    else if (!Array.isArray(body)) body = body != null ? [body] : [];
    o.body = body.map(asStr).filter(Boolean);
    o.after = asStr(o.after != null ? o.after : (o.conclusion != null ? o.conclusion : (o.response != null ? o.response : (o.mitigation != null ? o.mitigation : o.result))));
    o.note = asStr(o.note);
    return o;
  }

  function normMap(v) {
    if (typeof v === 'string') return { points: [{ x: 100, y: 100, name: v }] };
    if (Array.isArray(v)) return { points: v };
    if (!isObj(v)) return {};
    var o = v;
    o.points = toArr(o.points != null ? o.points : (o.markers != null ? o.markers : (o.pins != null ? o.pins : o.locations)));
    o.points = o.points.map(function (p, i) {
      if (typeof p === 'string') return { x: 60 + i * 50, y: 100, name: p };
      if (!isObj(p)) return null;
      var x = parseFloat(asStr(p.x != null ? p.x : p.left));
      var y = parseFloat(asStr(p.y != null ? p.y : p.top));
      return {
        x: isFinite(x) ? x : 60 + i * 50,
        y: isFinite(y) ? y : 100 + i * 20,
        name: asStr(p.name != null ? p.name : (p.label != null ? p.label : p.title)) || ('点位 ' + (i + 1)),
        coord: asStr(p.coord != null ? p.coord : (p.coordinate != null ? p.coordinate : p.id)),
        text: asStr(p.text != null ? p.text : (p.desc != null ? p.desc : (p.description != null ? p.description : p.content)))
      };
    }).filter(Boolean);
    o.region = asStr(o.region != null ? o.region : (o.area != null ? o.area : '收容地点'));
    o.scale = asStr(o.scale != null ? o.scale : '比例尺未标注');
    return o;
  }

  function normStatus(v) {
    var s = asStr(v).trim().toLowerCase();
    if (/^(ok|正常|完好|在库|合格|stable|good)$/.test(s)) return 'ok';
    if (/^(wt|观察|待定|部分|受损|watch)$/.test(s)) return 'wt';
    if (/^(ng|异常|损坏|缺失|失效|污染|fail|error)$/.test(s)) return 'ng';
    if (/^(un|未登记|未知|不明|unknown)$/.test(s)) return 'un';
    return 'ok';
  }

  function normList(v) {
    if (typeof v === 'string') return { items: splitList(v).map(function (s, i) { return { no: String(i + 1), name: s, status: 'ok' }; }) };
    if (Array.isArray(v)) return { items: v };
    if (!isObj(v)) return {};
    var o = v;
    o.items = toArr(o.items != null ? o.items : (o.entries != null ? o.entries : (o.inventory != null ? o.inventory : o.records)));
    o.items = o.items.map(function (it, i) {
      if (typeof it === 'string') return { no: String(i + 1), name: it, status: 'ok' };
      if (!isObj(it)) return null;
      return {
        no: asStr(it.no != null ? it.no : (it.id != null ? it.id : (it.index != null ? it.index : String(i + 1)))),
        name: asStr(it.name != null ? it.name : (it.title != null ? it.title : (it.item != null ? it.item : it.label))) || ('物证 ' + (i + 1)),
        qty: it.qty != null ? asStr(it.qty) : (it.quantity != null ? asStr(it.quantity) : (it.count != null ? asStr(it.count) : '—')),
        status: normStatus(it.status != null ? it.status : it.state),
        note: asStr(it.note != null ? it.note : (it.desc != null ? it.desc : (it.description != null ? it.description : it.text)))
      };
    }).filter(Boolean);
    o.note = asStr(o.note);
    return o;
  }

  function normReport(v) {
    if (typeof v === 'string') return { body: splitList(v) };
    if (Array.isArray(v)) return { body: v.map(asStr).filter(Boolean) };
    if (!isObj(v)) return {};
    var o = v;
    var body = o.body != null ? o.body : (o.content != null ? o.content : (o.text != null ? o.text : o.paras));
    if (typeof body === 'string') body = splitList(body);
    else if (!Array.isArray(body)) body = body != null ? [body] : [];
    o.body = body.map(asStr).filter(Boolean);
    return o;
  }

  function normSign(v) {
    if (typeof v === 'string') return { note: v };
    if (Array.isArray(v)) return { rows: v };
    if (!isObj(v)) return {};
    var o = v;
    o.rows = toArr(o.rows != null ? o.rows : (o.signatures != null ? o.signatures : o.entries));
    o.rows = o.rows.map(function (r, i) {
      if (typeof r === 'string') return { role: r, en: 'SIGN', name: '—', date: '', stamp: '', need: 2 };
      if (!isObj(r)) return null;
      return {
        role: asStr(r.role != null ? r.role : (r.title != null ? r.title : (r.position != null ? r.position : r.office))) || ('签批 ' + (i + 1)),
        en: asStr(r.en != null ? r.en : (r.enName != null ? r.enName : r.english)),
        name: asStr(r.name != null ? r.name : (r.signer != null ? r.signer : (r.person != null ? r.person : r.who))) || '—',
        date: asStr(r.date != null ? r.date : r.time),
        stamp: asStr(r.stamp),
        need: r.need != null ? Math.max(1, Math.min(5, Math.round(num(r.need, 2)))) : 2
      };
    }).filter(Boolean);
    o.note = asStr(o.note);
    return o;
  }

  function normalizeModuleData(id, v) {
    if (v == null) return v;
    if (id === 'atlas') return normAtlas(v);
    if (id === 'interview') return normInterview(v);
    if (id === 'log') return normLog(v);
    if (id === 'timeline') return normTimeline(v);
    if (id === 'photo') return normPhoto(v);
    if (id === 'letter') return normLetter(v);
    if (id === 'sandbox') return normSandbox(v);
    if (id === 'map') return normMap(v);
    if (id === 'list') return normList(v);
    if (id === 'report') return normReport(v);
    if (id === 'sign') return normSign(v);
    return v;
  }

  function normalize(raw) {
    var notesSeen = Object.create(null);
    function note(scope, detail) {
      var key = scope + '|' + detail;
      if (notesSeen[key]) return;
      notesSeen[key] = 1;
      state.normalized.push(scope + '：' + detail);
    }

    var d = raw;
    if (Array.isArray(d)) { d = d.length && isObj(d[0]) ? d[0] : {}; note('顶层', '数组已取第一个对象'); }
    if (typeof d === 'string') {
      try { d = JSON.parse(d); note('顶层', '字符串已解析为 JSON'); }
      catch (e) { d = {}; note('顶层', '字符串无法解析，已置空'); }
    }
    if (!isObj(d)) { d = {}; note('顶层', '不是对象，已置空'); }

    /* ---- identity ---- */
    var id = d.identity;
    if (!isObj(id)) {
      if (typeof id === 'string') { id = { name: id }; note('identity', '字符串已转为 {name}'); }
      else { id = {}; note('identity', '缺失或非对象，已补默认值'); }
    }
    d.identity = id;
    if (id.code == null && id.number != null) { id.code = id.number; note('identity.code', '由 number 补齐'); }
    if (id.code == null && id.id != null) { id.code = id.id; note('identity.code', '由 id 补齐'); }
    if (id.code == null) { id.code = 'CX-' + normTypeCode(id.typeCode != null ? id.typeCode : (id.type != null ? id.type : id.typeName)) + '-0000'; note('identity.code', '缺失，已生成默认编号'); }
    id.code = asStr(id.code);
    if (id.name == null) { id.name = asStr(id.title != null ? id.title : (id.projectName != null ? id.projectName : id.project)); }
    if (!id.name) { id.name = '未命名项目'; note('identity.name', '缺失，已用默认名'); }
    id.aliases = toArr(id.aliases).map(asStr).filter(Boolean);
    var tc = normTypeCode(id.typeCode != null ? id.typeCode : (id.type != null ? id.type : id.typeName));
    if (id.typeCode !== tc) note('identity.typeCode', '已归一化为 ' + tc);
    id.typeCode = tc;
    if (id.typeName == null) id.typeName = asStr(id.type);
    var grade = normGrade(id.grade != null ? id.grade : (id.gradeName != null ? id.gradeName : (id.class != null ? id.class : id.level)));
    if (id.grade !== grade) note('identity.grade', '已归一化为 ' + grade);
    id.grade = grade;
    var clearance = normClearance(id.clearance != null ? id.clearance : (id.clearLevel != null ? id.clearLevel : (id.access != null ? id.access : id.security)));
    if (id.clearance !== clearance) note('identity.clearance', '已归一化为 ' + clearance);
    id.clearance = clearance;
    if (id.site == null) id.site = asStr(id.location != null ? id.location : id.station);
    if (id.hume == null) id.hume = id.humeBase != null ? asStr(id.humeBase) : '';
    if (id.disrupt == null) id.disrupt = id.disruption != null ? asStr(id.disruption) : '';
    if (id.filed == null || id.filed === '') id.filed = asStr(id.date != null ? id.date : id.filingDate);
    if (id.status == null || id.status === '') id.status = asStr(id.state) || '观察中';

    function fixAtlas(a, scope) {
      if (!a) return a;
      var idGrade = normGrade(id.grade);
      if (GRADE_NAMES.indexOf(idGrade) < 0) idGrade = '无';
      var base = normGrade(a.grade != null ? a.grade : idGrade);
      if (GRADE_NAMES.indexOf(base) < 0) base = '无';
      if (a.beast) {
        var b = normGrade(a.beast);
        if (GRADE_NAMES.indexOf(b) >= 0) base = b;
        else note(scope + '.beast', '“' + asStr(a.beast) + '”无法识别，已回退为 ' + base);
      }
      a.beast = base;
      a.grade = normGrade(a.grade != null ? a.grade : idGrade);
      return a;
    }

    /* ---- summary ---- */
    if (d.summary == null) d.summary = d.abstract != null ? d.abstract : (d.overview != null ? d.overview : '');
    if (!(typeof d.summary === 'string')) { d.summary = asStr(d.summary); note('summary', '已转为字符串'); }

    /* ---- containment ---- */
    var c = d.containment;
    if (typeof c === 'string') { c = { protocols: splitList(c) }; note('containment', '字符串已转为 protocols'); }
    else if (Array.isArray(c)) { c = { protocols: c }; note('containment', '数组已转为 protocols'); }
    else if (!isObj(c)) { c = {}; note('containment', '缺失或非对象，已补空对象'); }
    d.containment = c;
    var prot = c.protocols != null ? c.protocols : (c.measures != null ? c.measures : (c.procedures != null ? c.procedures : (c.rules != null ? c.rules : c.items)));
    if (prot !== undefined && c.protocols !== prot) { c.protocols = prot; note('containment.protocols', '已由别名字段转入'); }
    if (typeof c.protocols === 'string') { c.protocols = splitList(c.protocols); note('containment.protocols', '字符串已拆分为数组'); }
    else if (!Array.isArray(c.protocols)) c.protocols = c.protocols != null ? [c.protocols] : [];
    c.protocols = c.protocols.map(asStr).filter(Boolean);
    if (c.notice == null) c.notice = c.warning != null ? c.warning : c.summary;
    c.notice = asStr(c.notice);
    if (c.specs !== undefined) c.specs = normSpecs(c.specs);
    if (c.supplies !== undefined) c.supplies = normSupplies(c.supplies);
    if (c.emergency !== undefined) c.emergency = normEmergency(c.emergency);
    else if (c.contingency !== undefined) { c.emergency = normEmergency(c.contingency); note('containment.emergency', '已由 contingency 转入'); }
    if (c.taboo !== undefined) c.taboo = normTaboo(c.taboo);
    else if (c.prohibited !== undefined) { c.taboo = normTaboo(c.prohibited); note('containment.taboo', '已由 prohibited 转入'); }

    /* ---- description ---- */
    var de = d.description;
    if (typeof de === 'string') { de = { paras: splitList(de) }; note('description', '字符串已转为 paras'); }
    else if (Array.isArray(de)) { de = { paras: de }; note('description', '数组已转为 paras'); }
    else if (!isObj(de)) { de = {}; note('description', '缺失或非对象，已补空对象'); }
    d.description = de;
    var paras = de.paras != null ? de.paras : (de.paragraphs != null ? de.paragraphs : (de.text != null ? de.text : (de.body != null ? de.body : de.content)));
    if (paras !== undefined && de.paras !== paras) { de.paras = paras; note('description.paras', '已由别名字段转入'); }
    if (typeof de.paras === 'string') { de.paras = splitList(de.paras); note('description.paras', '字符串已拆分为数组'); }
    else if (!Array.isArray(de.paras)) de.paras = de.paras != null ? [de.paras] : [];
    de.paras = de.paras.map(asStr).filter(Boolean);
    if (Array.isArray(de.deleted)) { de.deleted = de.deleted.map(asStr).filter(Boolean).join(' '); note('description.deleted', '数组已合并为一段'); }
    else de.deleted = asStr(de.deleted);
    if (typeof de.quote === 'string') { de.quote = { text: de.quote }; note('description.quote', '字符串已转为 {text}'); }
    else if (isObj(de.quote)) {
      de.quote = { text: asStr(de.quote.text != null ? de.quote.text : (de.quote.content != null ? de.quote.content : de.quote.body)), source: asStr(de.quote.source != null ? de.quote.source : (de.quote.from != null ? de.quote.from : de.quote.author)) };
    } else de.quote = null;
    if (de.tabs !== undefined) de.tabs = normTabs(de.tabs);
    else if (de.tab !== undefined) { de.tabs = normTabs(de.tab); note('description.tabs', '已由 tab 转入'); }
    if (de.atlas !== undefined) de.atlas = fixAtlas(normAtlas(de.atlas), 'description.atlas');
    else if (de.bestiary !== undefined) { de.atlas = fixAtlas(normAtlas(de.bestiary), 'description.atlas'); note('description.atlas', '已由 bestiary 转入'); }

    /* ---- monitoring ---- */
    var hadMonitoring = d.monitoring != null;
    var mon = d.monitoring;
    if (Array.isArray(mon)) { mon = { readings: mon }; note('monitoring', '数组已转为 readings'); }
    else if (typeof mon === 'string') { mon = { readings: splitList(mon) }; note('monitoring', '字符串已转为 readings'); }
    else if (!isObj(mon)) { mon = {}; if (hadMonitoring) note('monitoring', '非对象，已补空对象'); }
    d.monitoring = mon;
    if (mon.radar != null) {
      var r = mon.radar;
      if (Array.isArray(r)) r = { values: r };
      else if (typeof r === 'string') r = { values: splitNumbers(r) };
      else if (!isObj(r)) r = {};
      if (r.axes == null && r.labels != null) r.axes = r.labels;
      if (r.axes == null && r.axis != null) r.axes = r.axis;
      if (typeof r.axes === 'string') r.axes = r.axes.split(/[,，、/|]+/);
      if (r.axes != null && !Array.isArray(r.axes)) r.axes = [r.axes];
      var axes = r.axes != null ? r.axes.map(asStr).filter(Boolean) : [];
      while (axes.length < 6) axes.push(DEF_AXES[axes.length]);
      if (axes.length > 6) axes = axes.slice(0, 6);
      var vals = r.values != null ? r.values : (r.vals != null ? r.vals : r.value);
      if (typeof vals === 'string') vals = splitNumbers(vals);
      if (vals != null && !Array.isArray(vals)) vals = [vals];
      var valsArr = vals != null ? vals.map(function (v) { return clampNum(v, 0, 5); }) : [];
      while (valsArr.length < 6) valsArr.push(3);
      if (valsArr.length > 6) valsArr = valsArr.slice(0, 6);
      r.axes = axes; r.values = valsArr;
      mon.radar = r;
    }
    if (mon.hume != null && !isObj(mon.hume)) {
      mon.hume = typeof mon.hume === 'number' ? { base: mon.hume } : { base: parseSec(mon.hume) };
      note('monitoring.hume', '已转为对象');
    }
    if (mon.readings !== undefined || mon.records !== undefined || mon.logs !== undefined) {
      var rd = mon.readings != null ? mon.readings : (mon.records != null ? mon.records : mon.logs);
      if (rd !== mon.readings) { mon.readings = rd; note('monitoring.readings', '已由别名字段转入'); }
      if (typeof rd === 'string') mon.readings = splitList(rd);
      else if (isObj(rd) && !Array.isArray(rd)) mon.readings = Object.keys(rd).map(function (k) { return { time: k, reading: asStr(rd[k]) }; });
      else if (!Array.isArray(rd)) mon.readings = rd != null ? [rd] : [];
      mon.readings = mon.readings.map(function (x) {
        if (typeof x === 'string') return { time: '—', reading: x, operator: '—', judge: 'ok' };
        if (!isObj(x)) return null;
        return {
          time: asStr(x.time != null ? x.time : (x.t != null ? x.t : (x.at != null ? x.at : x.date))) || '—',
          reading: asStr(x.reading != null ? x.reading : (x.value != null ? x.value : (x.readout != null ? x.readout : (x.result != null ? x.result : x.data)))),
          operator: asStr(x.operator != null ? x.operator : (x.who != null ? x.who : (x.op != null ? x.op : x.staff))) || '—',
          judge: normJudge(x.judge != null ? x.judge : x.state)
        };
      }).filter(Boolean);
    }

    /* ---- modules ---- */
    var mods = d.modules;
    if (typeof mods === 'string') { mods = splitList(mods); note('modules', '字符串已拆分为数组'); }
    else if (isObj(mods) && !Array.isArray(mods)) {
      if (Array.isArray(mods.modules)) { mods = mods.modules; note('modules', '已读取 {modules:[...]}'); }
      else { mods = Object.keys(mods).filter(function (k) { return mods[k]; }); note('modules', '映射已转为数组'); }
    } else if (!Array.isArray(mods)) { if (mods != null) note('modules', '非数组，已置空'); mods = []; }
    var modOut = [], modSeen = Object.create(null);
    toArr(mods).forEach(function (m) {
      var rawId = isObj(m) ? (m.id != null ? m.id : (m.module != null ? m.module : (m.name != null ? m.name : m.type))) : m;
      var mid = normModuleId(rawId);
      if (mid && !modSeen[mid]) { modSeen[mid] = 1; modOut.push(mid); }
    });
    if (modOut.join(',') !== (Array.isArray(d.modules) ? d.modules.join(',') : '')) note('modules', '已归一化为 ' + modOut.join(','));
    d.modules = modOut;

    /* ---- moduleData ---- */
    var md = d.moduleData;
    if (Array.isArray(md)) {
      var mdArr = {};
      md.forEach(function (item) {
        if (!isObj(item)) return;
        var key = normModuleId(item.id != null ? item.id : (item.module != null ? item.module : (item.name != null ? item.name : item.type)));
        var val = item.data != null ? item.data : (item.value != null ? item.value : item);
        if (key) mdArr[key] = val;
      });
      md = mdArr;
      note('moduleData', '数组已转为对象');
    }
    if (!isObj(md)) { if (md != null) note('moduleData', '非对象，已置空'); md = {}; }
    var mdOut = Object.create(null);
    Object.keys(md).forEach(function (k) {
      var nk = normModuleId(k);
      if (!nk || mdOut[nk] !== undefined) return;
      mdOut[nk] = md[k];
    });
    var mdKeys = Object.keys(md), mdNewKeys = Object.keys(mdOut);
    if (mdKeys.join(',') !== mdNewKeys.join(',')) note('moduleData', '键已归一化');
    ['interview', 'log', 'timeline', 'photo', 'letter', 'sandbox', 'map', 'list', 'report', 'atlas', 'sign'].forEach(function (id) {
      if (mdOut[id] !== undefined) {
        mdOut[id] = normalizeModuleData(id, mdOut[id]);
        if (id === 'atlas') mdOut[id] = fixAtlas(mdOut[id], 'moduleData.atlas');
      }
    });
    if (d.modules.indexOf('atlas') >= 0 && de.atlas) {
      if (mdOut.atlas === undefined) {
        mdOut.atlas = fixAtlas(normAtlas(de.atlas), 'moduleData.atlas');
        note('moduleData.atlas', '已由 description.atlas 迁入');
      }
      delete de.atlas;
      note('description.atlas', '模块 atlas 已声明，子节不再重复渲染');
    }
    d.moduleData = mdOut;

    /* ---- structure ---- */
    var st = d.structure;
    if (st != null) {
      var arr;
      if (typeof st === 'string') { arr = [st]; note('structure', '字符串已转为单元素数组'); }
      else if (isObj(st) && !Array.isArray(st)) {
        if (Array.isArray(st.sections)) arr = st.sections;
        else if (Array.isArray(st.items)) arr = st.items;
        else if (Array.isArray(st.structure)) arr = st.structure;
        else arr = Object.keys(st).map(function (k) {
          var v = st[k];
          if (isObj(v)) { var o = {}; Object.keys(v).forEach(function (q) { o[q] = v[q]; }); if (o.id == null) o.id = k; return o; }
          return { id: k };
        });
        note('structure', '对象已转为数组');
      } else if (Array.isArray(st)) arr = st;
      if (arr) {
        var beforeSt = JSON.stringify(arr);
        arr = arr.map(function (item) {
          if (typeof item === 'string') return { id: normModuleId(item) };
          if (!isObj(item)) return item;
          var o = {};
          Object.keys(item).forEach(function (k) { o[k] = item[k]; });
          var rid = o.id != null ? o.id : (o.module != null ? o.module : (o.section != null ? o.section : o.key));
          if (rid != null) o.id = normModuleId(rid);
          if (o.title == null && o.name != null) o.title = o.name;
          if (typeof o.merge === 'string') o.merge = splitList(o.merge);
          if (Array.isArray(o.merge)) o.merge = o.merge.map(function (m) { return normModuleId(isObj(m) ? (m.id != null ? m.id : (m.module != null ? m.module : m.name)) : m); }).filter(Boolean);
          if (o.note == null && o.text != null) o.note = o.text;
          if (o.note == null && o.content != null) o.note = o.content;
          if (Array.isArray(o.note)) o.note = o.note.map(asStr).filter(Boolean).join('\n\n');
          if (o.note != null) o.note = asStr(o.note);
          return o;
        });
        d.structure = arr;
        if (JSON.stringify(arr) !== beforeSt) note('structure', '元素与 id 已归一化');
      } else {
        delete d.structure;
        note('structure', '无法识别，已忽略');
      }
    }

    return d;
  }

  function collectText(v, out, depth, key) {
    if (v == null || depth > 6) return out;
    if (typeof v === 'string') { if (!key || !/^(code|name|aliases|grade|clearance|site|hume|disrupt|filed|status|title|en|label)$/.test(key)) out.push(v); }
    else if (Array.isArray(v)) v.forEach(function (x) { collectText(x, out, depth + 1, key); });
    else if (isObj(v)) Object.keys(v).forEach(function (k) { collectText(v[k], out, depth + 1, k); });
    return out;
  }

  function softCheck(d) {
    var text = collectText(d, [], 0, '').join('');
    var diag = {
      wordCount: text.length,
      protocols: Array.isArray(d.containment && d.containment.protocols) ? d.containment.protocols.length : 0,
      paras: Array.isArray(d.description && d.description.paras) ? d.description.paras.length : 0,
      readings: Array.isArray(d.monitoring && d.monitoring.readings) ? d.monitoring.readings.length : 0,
      modules: Array.isArray(d.modules) ? d.modules.length : 0,
      moduleDataKeys: Object.keys(d.moduleData || {}).length,
      warnings: []
    };
    if (diag.wordCount < 1500) diag.warnings.push('正文约 ' + diag.wordCount + ' 字，建议 3000–5000 字');
    if (diag.protocols < 3) diag.warnings.push('收容措施 ' + diag.protocols + ' 条，建议 ≥5 条');
    if (diag.paras < 2) diag.warnings.push('项目描述 ' + diag.paras + ' 段，建议 ≥3 段');
    if (diag.readings && diag.readings < 3) diag.warnings.push('监测记录 ' + diag.readings + ' 行，建议 ≥4 行');
    if (diag.modules && diag.modules < 3) diag.warnings.push('仅声明 ' + diag.modules + ' 个模块，丰富度偏低');
    if (diag.warnings.length) console.warn('[存档软检查] ' + diag.warnings.join('；'));
    return diag;
  }

  function sectionShell(o) {
    return '<section class="sec" id="s' + o.index + '">' +
      '<div class="sec__head rv">' +
        '<div class="sec__no"><span>' + o.no + '</span></div>' +
        '<div><h2 class="sec__title">' + esc(o.title) + '</h2>' +
        '<span class="sec__en">' + esc(o.en) + '</span></div>' +
        '<div class="sec__line"></div>' +
        '<div class="sec__lv">' + esc(o.lv) + '</div>' +
      '</div>' + o.inner + '</section>';
  }

  function subsectionTitle(cn, en) {
    return '<h3 class="sub-title">' + esc(cn) + ' <small>' + esc(en) + '</small></h3>';
  }

  /* ==================== 读取数据 ==================== */

  function loadJSON(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(path + ' 返回 HTTP ' + res.status);
      // 与宿主一致：先剥离文末的 MAHOSHOJO_* 控制注释，再做 JSON.parse。
      // 这样即使目标文件带着元数据 trailer 也能直接打开，不产生页面报错。
      return res.text().then(function (txt) {
        var clean = txt.replace(/<!--\s*MAHOSHOJO_(?:ARENA_META|META|STREAM_META|TELEMETRY_META)[\s\S]*?-->[\s\S]*$/i, '').trim();
        return JSON.parse(clean);
      });
    });
  }

  function renderFatal(err) {
    setText('itemName', '档案数据未载入');
    setText('itemAlias', '本页等待生成流程写入档案数据');
    setText('copyId', '—');
    var host = $('#sections');
    if (!host) return;
    host.innerHTML =
      '<div class="page-err">' +
        '<h3>档案数据未载入</h3>' +
        '<p>本 Web 包的目标文件是 <code>data/archive.json</code>。请由竞技场的 Web 包生成流程写入该文件后重新打开。</p>' +
        '<p>若你是直接双击打开本页，浏览器会拦截本地 <code>fetch</code>；请改用本地服务器或由宿主打开。</p>' +
        '<p>诊断：<code>' + esc(err && err.message ? err.message : String(err)) + '</code></p>' +
      '</div>';
    setText('footFile', '未载入');
  }

  /* ==================== 抬头与元信息 ==================== */

  function gradeOf(identity) {
    var raw = String(identity && identity.grade ? identity.grade : '').trim().toUpperCase();
    for (var i = 0; i < GRADES.length; i++) {
      if (GRADES[i].alias.some(function (a) { return a.toUpperCase() === raw; })) return GRADES[i];
    }
    return GRADES[0];
  }

  function applyIdentity(d) {
    var id = d.identity || {};
    var grade = gradeOf(id);
    var code = id.code || '—';
    var name = id.name || '—';
    var aliases = Array.isArray(id.aliases) ? id.aliases.filter(Boolean) : [];
    var clearance = /^L[1-5]$/.test(String(id.clearance)) ? id.clearance : 'L3';

    setText('itemNo', code);
    setText('copyId', code);
    setText('barcodeTxt', code);
    setText('itemName', name);
    setText('itemAlias', '别名／俗称：' + (aliases.length ? aliases.join(' · ') : '无记录'));
    setText('metaGrade', grade.name + '级');
    setText('metaType', (id.typeCode || '—') + (id.typeName ? '｜' + id.typeName : ''));
    setText('metaClearance', clearance);
    setText('metaSite', id.site || '—');
    setText('metaHume', id.hume || '—');
    setText('metaDisrupt', id.disrupt || '—');
    setText('metaFiled', id.filed || '—');
    setText('metaStatus', id.status || '—');
    setText('badgeName', grade.name);
    setText('badgeEn', grade.en);
    document.title = name === '—' ? '存续院收容档案' : name + ' · 收容档案';

    $('#badgeName').style.fontSize = grade.name.length > 1 ? '34px' : '44px';
    document.documentElement.style.setProperty('--grade', grade.c);

    var summary = $('#itemSummary');
    if (summary) {
      if (typeof d.summary === 'string' && d.summary.trim()) {
        summary.textContent = d.summary.trim();
        summary.hidden = false;
      } else {
        summary.hidden = true;
      }
    }

    state.clearance = +clearance.replace('L', '');
    $$('#clearPick button').forEach(function (b) {
      b.classList.toggle('is-on', +b.dataset.lv === state.clearance);
    });

    drawBarcode(code);
  }

  function drawBarcode(text) {
    var bc = $('#barcode');
    if (!bc) return;
    var html = '', seed = 0;
    for (var i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; }
    for (var k = 0; k < 46; k++) {
      html += '<i style="width:' + (1 + Math.floor(rnd() * 3)) + 'px;margin-right:' + (1 + Math.floor(rnd() * 2)) + 'px"></i>';
    }
    bc.innerHTML = html;
  }

  /* ==================== 壹 · 收容措施 ==================== */

  function containmentInner(c) {
    c = c || {};
    var html = '';

    if (c.notice) {
      html += '<div class="alert alert--gold rv">' +
        '<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">' +
        '<path d="M20 4 L36 34 H4 Z"/><path d="M20 15 V24"/><circle cx="20" cy="29" r="1.6" fill="currentColor"/></svg>' +
        '<div><b>收容要点</b><p>' + rich(c.notice) + '</p></div></div>';
    }

    if (Array.isArray(c.protocols) && c.protocols.length) {
      html += '<ol class="measures rv">' + c.protocols.filter(Boolean).map(function (p) {
        return '<li>' + rich(p) + '</li>';
      }).join('') + '</ol>';
    }

    if (Array.isArray(c.specs) && c.specs.length) {
      html += subsectionTitle('收容间参数', 'CELL PARAMETERS') +
        '<dl class="spec rv">' + c.specs.filter(function (s) { return s && s.label; }).map(function (s) {
          var ratio = clamp(num(s.ratio, 50), 0, 100);
          return '<div><dt>' + esc(s.label) + '</dt><dd>' + esc(s.value == null ? '—' : s.value) +
            '</dd><div class="gauge"><i style="--v:' + ratio + '%"></i></div></div>';
        }).join('') + '</dl>';
    }

    if (Array.isArray(c.supplies) && c.supplies.length) {
      html += subsectionTitle('常备物资', 'SUPPLIES') + '<div class="chips rv">' +
        c.supplies.filter(function (s) { return s && s.name; }).map(function (s) {
          var q = s.qty == null || s.qty === '' ? '按需' : (typeof s.qty === 'number' ? '×' + s.qty : String(s.qty));
          return '<span class="chip"><i>' + esc(q) + '</i>' + esc(s.name) + '</span>';
        }).join('') + '</div>';
    }

    if (Array.isArray(c.emergency) && c.emergency.length) {
      var colors = ['#9a7a3a', '#a8281e', '#5e130d', '#3a1a16'];
      html += subsectionTitle('应急协议', 'CONTINGENCY') + c.emergency.filter(Boolean).map(function (e, i) {
        var steps = Array.isArray(e.steps) && e.steps.length
          ? '<ol>' + e.steps.filter(Boolean).map(function (s) { return '<li>' + rich(s) + '</li>'; }).join('') + '</ol>'
          : '';
        return '<details class="acc rv" style="--c:' + (e.color || colors[i % colors.length]) + '">' +
          '<summary><span class="lvl">' + esc(e.level || ('第' + (i + 1) + '级')) + '</span>' + esc(e.title || '应急协议') + '</summary>' +
          '<div class="acc__body">' + (e.body ? rich(e.body) : '') + steps + '</div></details>';
      }).join('');
    }

    if (Array.isArray(c.taboo) && c.taboo.length) {
      html += subsectionTitle('禁忌事项', 'PROHIBITED') + '<div class="taboo rv">' +
        c.taboo.filter(Boolean).map(function (t) {
          return '<div><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
            '<circle cx="20" cy="20" r="16"/><path d="M9 31 L31 9"/></svg>' +
            '<b>' + esc(t.title || '—') + '</b><p>' + rich(t.text || '') + '</p></div>';
        }).join('') + '</div>';
    }

    return html || '<p class="rv">本节未记录可归档内容。</p>';
  }

  /* ==================== 贰 · 项目描述 ==================== */

  function descriptionInner(d) {
    d = d || {};
    var html = paras(d.paras);

    if (d.deleted) {
      html += '<div class="del-block rv"><span>' + esc(d.deleted) + '</span></div>';
    }

    if (d.quote && d.quote.text) {
      html += '<blockquote class="quote rv">' + rich(d.quote.text) +
        (d.quote.source ? '<cite>—— ' + esc(d.quote.source) + '</cite>' : '') + '</blockquote>';
    }

    if (Array.isArray(d.tabs) && d.tabs.length) {
      html += '<div class="tabs rv"><div class="tabs__nav">' +
        d.tabs.filter(Boolean).map(function (t, i) {
          return '<button type="button" class="' + (i === 0 ? 'is-on' : '') + '" data-p="' + i + '">' + esc(t.label || '—') + '</button>';
        }).join('') + '</div>' +
        d.tabs.filter(Boolean).map(function (t, i) {
          return '<div class="tabs__pane' + (i === 0 ? ' is-on' : '') + '">' + rich(t.body || '') + '</div>';
        }).join('') + '</div>';
    }

    if (d.atlas && (d.atlas.text || d.atlas.beast) && state.declared.indexOf('atlas') < 0) {
      html += subsectionTitle(d.atlas.title || '山海图志', 'BESTIARY ENTRY') +
        '<div class="atlas rv" id="atlas"><div class="atlas__text">' + paras(d.atlas.text) + '</div>' +
        '<div class="atlas__fig">' + CXModule.beastSvg(d.atlas.beast) +
        '<div class="atlas__cap">' + esc(d.atlas.caption || CXModule.beastCaption(d.atlas.beast)) + '</div></div></div>';
    }

    return html || '<p class="rv">本节未记录可归档内容。</p>';
  }

  /* ==================== 叁 · 监测数据 ==================== */

  function monitoringInner(m) {
    m = m || {};
    var radar = m.radar || {};
    var axes = Array.isArray(radar.axes) && radar.axes.length === 6
      ? radar.axes.map(function (a) { return String(a); })
      : state.radar.axes;
    var vals = Array.isArray(radar.values) && radar.values.length === 6
      ? radar.values.map(function (v) { return clamp(num(v, 0), 0, 5); })
      : state.radar.vals.slice();
    state.radar = { axes: axes, vals: vals };

    var hume = m.hume || {};
    state.hume = { base: clamp(num(hume.base, 100), 70, 110) };

    var readings = Array.isArray(m.readings) ? m.readings.filter(Boolean) : [];
    var judgeMap = { ok: ['正常', 'ok'], wt: ['观察', 'wt'], ng: ['异常', 'ng'] };

    return '<div class="dash rv">' +
        '<div class="panel"><div class="panel__cap"><span>属性偏离</span><b id="radarSum">0</b></div>' +
          '<svg id="radar" viewBox="0 0 300 300" role="img" aria-label="属性雷达图"></svg></div>' +
        '<div class="panel"><div class="panel__cap"><span>休谟场实时读数</span><b id="humeState">STABLE</b></div>' +
          '<canvas id="hume"></canvas>' +
          '<dl class="readouts">' +
            '<div><dt>HUME</dt><dd id="roHume">' + num(hume.readout, state.hume.base).toFixed(1) + '</dd></div>' +
            '<div><dt>FLUX</dt><dd id="roFlux">±' + (num(hume.flux, 0).toFixed(2)) + '</dd></div>' +
            '<div><dt>ANCHOR</dt><dd id="roAnchor">' + esc(hume.anchor || 'NOMINAL') + '</dd></div>' +
            '<div><dt>ALERT</dt><dd id="roAlert" class="warn">' + esc(String(hume.alert == null ? 0 : hume.alert)) + '</dd></div>' +
          '</dl>' +
          '<div class="lamps"><span><i></i>收容稳定</span><span><i class="y"></i>观测中</span><span><i class="r"></i>危及现实</span></div>' +
        '</div></div>' +
      (readings.length
        ? '<table class="tbl rv"><thead><tr><th>时间</th><th>读数</th><th>操作员</th><th>判定</th></tr></thead><tbody>' +
          readings.map(function (r) {
            var j = judgeMap[r.judge] || judgeMap.ok;
            return '<tr><td class="mono">' + esc(r.time || '—') + '</td><td>' + esc(r.reading || '—') +
              '</td><td>' + esc(r.operator || '—') + '</td><td><span class="st ' + j[1] + '">' + j[0] + '</span></td></tr>';
          }).join('') + '</tbody></table>'
        : '');
  }

  /* ==================== 模块装配 ==================== */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('模块脚本加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  function addRail(label, index, letter) {
    var rail = $('#rail');
    if (!rail) return;
    rail.insertAdjacentHTML('beforeend',
      '<a href="#s' + index + '" data-sec="s' + index + '">' +
      (letter ? '<b>' + esc(letter) + '</b> ' : '') + esc(label) + '</a>');
    state.rail.push(index);
  }

  async function mountModules(d) {
    var host = $('#sections');
    var declared = Array.isArray(d.modules) ? d.modules.filter(function (x) { return typeof x === 'string' && x.trim(); }) : [];
    var seen = Object.create(null);
    var order = [];
    declared.forEach(function (id) {
      id = id.trim();
      if (!seen[id]) { seen[id] = 1; order.push(id); }
    });
    state.declared = order;

    var catalog = { modules: [], primitives: {} };
    try {
      catalog = await loadJSON('modules/registry.json');
    } catch (e) {
      state.failed.push('modules/registry.json');
    }
    var map = Object.create(null);
    (catalog.modules || []).forEach(function (m) { if (m && m.id) map[m.id] = m; });

    var BASE = {
      containment: { label: '特殊收容措施', en: 'Special Containment Procedures', lv: 'L2' },
      description: { label: '项目描述', en: 'Description', lv: 'L2' },
      monitoring: { label: '监测数据', en: 'Monitoring Data', lv: 'L3' }
    };

    function cleanStr(v) { return typeof v === 'string' ? v.trim() : ''; }

    function lvNum(v) {
      var n = Number(String(v || '').replace(/[^0-9]/g, ''));
      return isFinite(n) ? n : 0;
    }

    function maxLv(current, next) {
      var n = Math.max(lvNum(current), lvNum(next));
      return n ? ('L' + n) : 'L1';
    }

    function hasData(v) {
      if (!v || typeof v !== 'object') return false;
      return Object.keys(v).some(function (k) {
        var x = v[k];
        if (x == null || x === '') return false;
        if (Array.isArray(x)) return x.length > 0;
        if (typeof x === 'object') return Object.keys(x).length > 0;
        return true;
      });
    }

    function noteIgnored(id, why) {
      state.ignored.push(id);
      console.warn('[存档装配] 已忽略：' + id + (why ? '（' + why + '）' : ''));
    }

    function markEmpty(id) {
      if (state.empty.indexOf(id) === -1) state.empty.push(id);
    }

    function baseInner(id, bd) {
      if (id === 'containment') return containmentInner(bd);
      if (id === 'description') return descriptionInner(bd);
      if (id === 'monitoring') return monitoringInner(bd);
      return '';
    }

    function noteShell(n) {
      var title = n.title ? '<h3 class="transit__title">' + CXModule.esc(n.title) + '</h3>' : '';
      var body = String(n.text || '').split(/\n{2,}/).map(function (p) {
        return '<p>' + CXModule.nl2br(p) + '</p>';
      }).join('');
      return '<aside class="transit rv" data-kind="note">' + title + '<div class="transit__body">' + body + '</div></aside>';
    }

    function isDeclared(id) {
      return state.declared.indexOf(id) >= 0;
    }

    async function resolveMember(id) {
      if (BASE[id]) {
        if (!hasData(d[id])) {
          markEmpty('base:' + id);
          return null;
        }
        return { id: id, kind: 'base', data: d[id], lv: BASE[id].lv, label: BASE[id].label, en: BASE[id].en };
      }
      var meta = map[id];
      if (!meta) {
        noteIgnored(id, '未知模块');
        return null;
      }
      if (!isDeclared(id)) {
        noteIgnored(id, '未在 modules 中声明');
        return null;
      }
      var md = (d.moduleData && d.moduleData[id]) || {};
      if (id !== 'sign' && !hasData(md)) {
        markEmpty(id);
        console.warn('[存档装配] 空模块已跳过：' + id);
        return null;
      }
      try {
        await loadScript(meta.script);
      } catch (e) {
        state.failed.push(id);
        console.warn('[存档装配] 模块脚本不可用：' + id + '（' + e.message + '）');
        return null;
      }
      var mod = window.CXModule.get(id);
      if (!mod) {
        state.failed.push(id);
        console.warn('[存档装配] 模块未注册：' + id);
        return null;
      }
      return {
        id: id, kind: 'module', mod: mod, data: md,
        lv: meta.clearance === 'auto' ? ((d.identity && d.identity.clearance) || 'L3') : (meta.clearance || 'L2'),
        label: meta.label || id, en: meta.en || ''
      };
    }

    function planDefault() {
      var plan = ['containment', 'description'].map(function (id) {
        return { kind: 'section', primary: id, merges: [], title: '', en: '' };
      });
      if (isDeclared('atlas')) {
        plan.push({ kind: 'section', primary: 'atlas', merges: [], title: '', en: '' });
      }
      plan.push({ kind: 'section', primary: 'monitoring', merges: [], title: '', en: '' });
      state.declared.forEach(function (id) {
        if (id !== 'sign' && id !== 'atlas') plan.push({ kind: 'section', primary: id, merges: [], title: '', en: '' });
      });
      if (isDeclared('sign')) plan.push({ kind: 'section', primary: 'sign', merges: [], title: '', en: '', sign: true });
      return plan;
    }

    function planFromStructure(raw) {
      var plan = [];
      var placed = Object.create(null);
      var signOpt = null;

      raw.forEach(function (item, idx) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          noteIgnored('structure#' + idx, '不是对象');
          return;
        }
        var id = cleanStr(item.id);
        if (!id) {
          noteIgnored('structure#' + idx, '缺少 id');
          return;
        }
        if (id === 'note') {
          if (!cleanStr(item.note)) {
            noteIgnored('structure#' + idx, 'note 为空');
            return;
          }
          plan.push({ kind: 'note', title: cleanStr(item.title), en: cleanStr(item.en), text: String(item.note) });
          return;
        }
        if (id === 'sign') {
          if (!signOpt) signOpt = { title: cleanStr(item.title), en: cleanStr(item.en) };
          else noteIgnored('structure:sign', '重复 sign');
          return;
        }
        if (!BASE[id] && !(map[id] && isDeclared(id))) {
          noteIgnored(id, 'structure 中的未知或未声明项');
          return;
        }
        if (placed[id]) {
          noteIgnored('structure:duplicate:' + id);
          return;
        }
        placed[id] = 1;
        var merges = [];
        if (item.merge !== undefined) {
          if (!Array.isArray(item.merge)) {
            noteIgnored('structure:merge:' + id, 'merge 不是数组');
          } else {
            item.merge.forEach(function (rawId) {
              var mid = cleanStr(rawId);
              if (!mid) return;
              if (mid === 'sign') {
                noteIgnored('structure:merge:sign', 'sign 不可合并');
                return;
              }
              if (placed[mid]) {
                noteIgnored('structure:duplicate:' + mid);
                return;
              }
              if (BASE[mid] || (map[mid] && isDeclared(mid))) {
                placed[mid] = 1;
                merges.push(mid);
                return;
              }
              noteIgnored(mid, 'merge 中的未知或未声明项');
            });
          }
        }
        plan.push({ kind: 'section', primary: id, merges: merges, title: cleanStr(item.title), en: cleanStr(item.en) });
      });

      state.declared.forEach(function (id) {
        if (id !== 'sign' && !placed[id]) state.unmounted.push(id);
      });

      if (isDeclared('sign')) {
        plan.push({
          kind: 'section', primary: 'sign', merges: [], sign: true,
          title: signOpt ? signOpt.title : '', en: signOpt ? signOpt.en : ''
        });
      } else if (signOpt) {
        noteIgnored('sign', '未在 modules 中声明');
      }
      return plan;
    }

    var structure = Array.isArray(d.structure) && d.structure.length ? d.structure : null;
    state.structureUsed = !!structure;
    var plan = structure ? planFromStructure(structure) : planDefault();

    var index = 0;
    var letterIndex = 0;

    for (var p = 0; p < plan.length; p++) {
      var step = plan[p];
      if (step.kind === 'note') {
        host.insertAdjacentHTML('beforeend', noteShell(step));
        continue;
      }

      var ids = [step.primary].concat(step.merges || []);
      var members = [];
      for (var m = 0; m < ids.length; m++) {
        var member = await resolveMember(ids[m]);
        if (member) members.push(member);
      }
      if (!members.length) {
        if (!step.sign) markEmpty('section:' + step.primary);
        continue;
      }

      var primary = step.primary;
      var primaryIsModule = !BASE[primary] && primary !== 'sign' && primary !== 'report';
      var letter = primaryIsModule ? (ALPHA[letterIndex] || '') : '';
      var defaultLabel = step.sign ? '签批流程' : (BASE[primary] ? BASE[primary].label : (map[primary] && map[primary].label) || primary);
      var defaultEn = step.sign ? 'Approval & Signatures' : (BASE[primary] ? BASE[primary].en : (map[primary] && map[primary].en) || '');
      var label = step.title || defaultLabel;
      var title = letter ? ('附录 ' + letter + '：' + label) : label;
      var en = step.en || (letter ? ('Appendix ' + letter + ' · ' + defaultEn) : defaultEn);

      var secIndex = index + 1;
      var lv = members.reduce(function (acc, mem) { return maxLv(acc, mem.lv); }, 'L1');
      var parts = [];
      var inits = [];

      for (var n = 0; n < members.length; n++) {
        var mem = members[n];
        var inner = '';
        if (mem.kind === 'base') {
          try {
            inner = baseInner(mem.id, mem.data);
          } catch (e) {
            state.failed.push('base:' + mem.id);
            console.warn('[存档装配] 基础章节渲染异常：' + mem.id, e);
          }
        } else {
          try {
            inner = mem.mod.render(mem.data, { id: mem.id, letter: letter, index: secIndex, clearance: lv });
          } catch (e) {
            state.failed.push(mem.id);
            console.warn('[存档装配] 模块渲染异常：' + mem.id, e);
          }
        }
        if (!inner || !String(inner).trim()) {
          markEmpty(mem.id);
          continue;
        }
        parts.push('<div class="merge-member" data-mod="' + CXModule.esc(mem.id) + '">' + inner + '</div>');
        inits.push(mem);
      }

      if (!parts.length) {
        if (!step.sign) markEmpty('section:' + step.primary);
        continue;
      }

      host.insertAdjacentHTML('beforeend', sectionShell({
        index: secIndex, no: CN[secIndex - 1] || String(secIndex),
        title: title, en: en, lv: lv, inner: parts.join('')
      }));
      var section = host.lastElementChild;
      section.dataset.members = ids.join(',');

      inits.forEach(function (mem) {
        if (mem.kind !== 'module' || typeof mem.mod.init !== 'function') return;
        var sub = null;
        $$('.merge-member', section).forEach(function (el) {
          if (!sub && el.dataset.mod === mem.id) sub = el;
        });
        try {
          mem.mod.init(sub || section, mem.data, { id: mem.id, letter: letter, index: secIndex, clearance: lv });
        } catch (e) {
          state.failed.push(mem.id + ':init');
          console.warn('[存档装配] 模块交互初始化异常：' + mem.id, e);
        }
      });

      if (members.some(function (mem) { return mem.kind === 'module'; })) {
        members.forEach(function (mem) { if (mem.kind === 'module' && state.mounted.indexOf(mem.id) < 0) state.mounted.push(mem.id); });
      }

      addRail(label, secIndex, letter);
      index += 1;
      if (letter) letterIndex += 1;
    }
  }

  /* ==================== 交互：权限 / 黑条 ==================== */

  function setClear(lv, silent) {
    state.clearance = lv;
    $$('#clearPick button').forEach(function (b) { b.classList.toggle('is-on', +b.dataset.lv === lv); });
    $$('.rd.is-open').forEach(function (r) { if (+r.dataset.lv > lv) closeRd(r); });
    $$('.sec').forEach(function (s) {
      var tag = $('.sec__lv', s);
      if (!tag) return;
      var need = +String(tag.textContent).replace('L', '');
      tag.style.color = need > lv ? 'var(--cinnabar)' : '';
      tag.style.borderColor = need > lv ? 'var(--cinnabar)' : '';
      tag.title = need > lv ? '当前权限不足以完整阅读本节' : '';
    });
    if (!silent) toast('当前权限 L' + lv + (lv >= 5 ? '。这已是院级权限，请谨慎。' : '。'), lv >= 5);
  }

  function closeRd(r) {
    r.classList.remove('is-open');
    r.textContent = (r.dataset.text || '').replace(/[^\s]/g, '█');
  }

  var denyCount = 0;
  function toggleRd(r) {
    if (r.classList.contains('is-open')) { closeRd(r); return; }
    if (state.clearance >= +r.dataset.lv) {
      r.classList.add('is-open');
      r.textContent = r.dataset.text || '';
    } else {
      denyCount++;
      r.classList.remove('is-deny');
      void r.offsetWidth;
      r.classList.add('is-deny');
      toast('权限不足：需要 L' + r.dataset.lv + '。这是你本次第 ' + denyCount + ' 次越权尝试。', true);
    }
  }

  function prepareRedactions() {
    $$('.rd').forEach(function (r) {
      if (r.dataset.prepared === '1') return;
      r.dataset.prepared = '1';
      r.dataset.text = r.textContent;
      r.textContent = r.textContent.replace(/[^\s]/g, '█');
      r.tabIndex = 0;
      r.setAttribute('role', 'button');
      r.setAttribute('aria-label', '已涂黑内容，需要 L' + r.dataset.lv + ' 权限');
    });
  }

  /* ==================== 交互：标签页 ==================== */

  function initTabs() {
    $$('.tabs').forEach(function (tabs) {
      if (tabs.dataset.bound === '1') return;
      tabs.dataset.bound = '1';
      var btns = $$('.tabs__nav button', tabs), panes = $$('.tabs__pane', tabs);
      btns.forEach(function (b, i) {
        b.addEventListener('click', function () {
          btns.forEach(function (x, j) { x.classList.toggle('is-on', j === i); });
          panes.forEach(function (p, j) { p.classList.toggle('is-on', j === i); });
        });
      });
    });
  }

  /* ==================== 交互：雷达与休谟 ==================== */

  function drawRadar() {
    var svg = $('#radar');
    if (!svg) return;
    var axes = state.radar.axes, vals = state.radar.vals;
    var cx = 150, cy = 150, R = 105, n = axes.length, html = '';
    function pt(i, r) {
      var a = -Math.PI / 2 + i / n * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }
    for (var lv = 1; lv <= 5; lv++) {
      html += '<polygon class="grid" points="' + axes.map(function (_, i) { return pt(i, R * lv / 5).join(','); }).join(' ') + '"/>';
    }
    axes.forEach(function (a, i) {
      var p = pt(i, R), q = pt(i, R + 22);
      html += '<line class="ax" x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '"/>';
      html += '<text x="' + q[0] + '" y="' + (q[1] + 4) + '">' + esc(a) + '</text>';
    });
    var pts = vals.map(function (v, i) { return pt(i, R * v / 5); });
    html += '<polygon class="area" points="' + pts.map(function (p) { return p.join(','); }).join(' ') + '"/>';
    pts.forEach(function (p) { html += '<circle class="pt" cx="' + p[0] + '" cy="' + p[1] + '" r="3"/>'; });
    svg.innerHTML = html;
    var sum = $('#' + 'radarSum');
    if (sum) sum.textContent = vals.reduce(function (a, b) { return a + b; }, 0) + ' / 30';
  }

  function initHume() {
    var cv = $('#hume');
    if (!cv) return;
    var ctx = cv.getContext('2d'), W, H, hist = [], alerts = 0;
    function resize() {
      var d = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * d; cv.height = H * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();
    if (!W || !H) return;

    function css(v) { return getComputedStyle(document.body).getPropertyValue(v).trim(); }
    var last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (t - last < 60) return;
      last = t;
      var breach = document.body.classList.contains('is-breach');
      var danger = state.radar.vals[0] + state.radar.vals[5];
      var base = breach ? 62 + Math.sin(t / 300) * 18 : state.hume.base - danger * 0.8;
      var v = base + (Math.random() - 0.5) * (breach ? 14 : 0.6 + danger * 0.25);
      if (!breach && Math.random() < 0.01) v -= 6 + Math.random() * 6;
      hist.push(v);
      if (hist.length > W / 3) hist.shift();
      if (v < 90) alerts++;

      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = css('--line');
      ctx.lineWidth = 1;
      for (var y = 0; y <= 4; y++) {
        var yy = 10 + y * (H - 20) / 4;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
      }
      ctx.fillStyle = css('--ink-3');
      ctx.font = '9px Consolas, monospace';
      ['110', '100', '90', '80', '70'].forEach(function (s, i) { ctx.fillText(s, 4, 18 + i * (H - 20) / 4); });

      function yOf(val) { return 10 + (110 - val) / 40 * (H - 20); }
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = css('--cinnabar');
      ctx.globalAlpha = .6;
      ctx.beginPath(); ctx.moveTo(0, yOf(90)); ctx.lineTo(W, yOf(90)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      var col = breach ? css('--cinnabar') : (css('--grade') || css('--bronze'));
      ctx.beginPath();
      hist.forEach(function (h, i) { var x = W - (hist.length - i) * 3; if (i) ctx.lineTo(x, yOf(h)); else ctx.moveTo(x, yOf(h)); });
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineTo(W, H); ctx.lineTo(W - hist.length * 3, H); ctx.closePath();
      ctx.globalAlpha = .14; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;

      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(W - 3, yOf(v), 3, 0, Math.PI * 2); ctx.fill();

      setText('roHume', v.toFixed(1));
      setText('roFlux', '±' + Math.abs(v - (hist[hist.length - 2] || v)).toFixed(2));
      var anchor = breach ? 'OVERLOAD' : (v < 90 ? 'STRAIN' : 'NOMINAL');
      var roAnchor = $('#roAnchor');
      if (roAnchor) { roAnchor.textContent = anchor; roAnchor.className = breach || v < 90 ? 'warn' : ''; }
      setText('roAlert', alerts);
    }
    requestAnimationFrame(frame);
  }

  /* ==================== 交互：闸门 / 主题 / 收容失效 ==================== */

  function initGate() {
    var gate = $('#gate'), go = $('#gateGo'), msg = $('#gateMsg');
    var stage = $('.stage'), bar = $('.bar');
    function release() {
      document.body.classList.remove('is-gated');
      if (stage) stage.inert = false;
      if (bar) bar.inert = false;
    }
    if (stage) stage.inert = true;
    if (bar) bar.inert = true;
    $$('#gateTest button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#gateTest button').forEach(function (x) { x.classList.remove('ok', 'ng'); });
        if (b.dataset.ok === '1') {
          b.classList.add('ok');
          msg.textContent = '正确。“署名”是档案规范要求，不是污染特征。';
          msg.style.color = '#8fd1a8';
          go.disabled = false;
        } else {
          b.classList.add('ng');
          msg.textContent = '“' + b.textContent + '”属于典型污染特征。请再看一遍。';
          msg.style.color = '#e2594d';
          go.disabled = true;
        }
      });
    });
    function enter(skipped) {
      gate.classList.add('is-gone');
      release();
      var stamp = $('#mainStamp');
      if (stamp) setTimeout(function () { stamp.classList.add('is-down'); }, 900);
      var sheet = $('#sheet');
      if (sheet) setTimeout(function () { sheet.focus({ preventScroll: true }); }, 250);
      if (skipped) toast('已跳过认知检查。档案科记录仅为本页虚构演出。', true);
    }
    go.addEventListener('click', function () { enter(false); });
    $('#gateSkip').addEventListener('click', function () { enter(true); });
  }

  function initTheme() {
    function setTheme(t) {
      document.body.dataset.theme = t;
      $('#themeBtn').textContent = t === 'ink' ? '◐ 宣纸' : '◑ 玄墨';
    }
    $('#themeBtn').addEventListener('click', function () {
      setTheme(document.body.dataset.theme === 'ink' ? 'paper' : 'ink');
    });
    setTheme('paper');
  }

  function initBreach() {
    var timer = null, seconds = 0;
    function setBreach(on) {
      document.body.classList.toggle('is-breach', on);
      clearInterval(timer);
      if (on) {
        seconds = 0;
        $('#breachClock').textContent = '00:00';
        timer = setInterval(function () {
          seconds++;
          $('#breachClock').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
        }, 1000);
        setText('humeState', 'BREACH');
        toast('警报：三级应急协议已启动。', true);
      } else {
        setText('humeState', 'STABLE');
        if (seconds) toast('收容已恢复。持续时间 ' + $('#breachClock').textContent + '。请补写事件报告。');
      }
    }
    $('#breachBtn').addEventListener('click', function () { setBreach(!document.body.classList.contains('is-breach')); });
    $('#breachOff').addEventListener('click', function () { setBreach(false); });
    window.__CX_SET_BREACH__ = setBreach;
  }

  /* ==================== 交互：导航 / 滚动 ==================== */

  function initNav() {
    var fab = $('#railFab'), scrim = $('#railScrim'), close = $('#railClose'), rail = $('#rail');
    if (!fab || !rail) return;
    function isOn() { return document.body.classList.contains('is-nav'); }
    function setOpen(on, returnFocus) {
      document.body.classList.toggle('is-nav', on);
      fab.setAttribute('aria-expanded', String(on));
      if (scrim) scrim.hidden = !on;
      if (on) { if (close) close.focus(); }
      else if (returnFocus !== false) { fab.focus(); }
    }
    fab.addEventListener('click', function () { setOpen(!isOn()); });
    if (scrim) scrim.addEventListener('click', function () { setOpen(false); });
    if (close) close.addEventListener('click', function () { setOpen(false); });
    $$('#rail a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false, false); }); });
    window.addEventListener('resize', function () { if (window.innerWidth > 900 && isOn()) setOpen(false, false); });
    window.CXcloseNav = function () { if (isOn()) setOpen(false); };
  }

  function initScroll() {
    var progress = $('#progress');
    function onScroll() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (progress) progress.style.width = (h > 0 ? window.scrollY / h * 100 : 0) + '%';
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (!('IntersectionObserver' in window)) {
      $$('.rv').forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.08 });
    $$('.rv').forEach(function (el) { io.observe(el); });

    var railObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          $$('#rail a').forEach(function (a) {
            var on = a.dataset.sec === en.target.id;
            a.classList.toggle('is-on', on);
            if (on) {
              var rail = $('#rail');
              if (!rail) return;
              var max = rail.scrollHeight - rail.clientHeight;
              var top = a.offsetTop - (rail.clientHeight - a.offsetHeight) / 2;
              rail.scrollTop = Math.max(0, Math.min(top, max));
            }
          });
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('.sec').forEach(function (s) { railObs.observe(s); });

    var atlas = $('#atlas');
    if (atlas) {
      var atlasObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); atlasObs.unobserve(en.target); } });
      }, { threshold: 0.3 });
      atlasObs.observe(atlas);
    }
  }

  function initInkDots() {
    var sheet = $('#sheet');
    if (!sheet) return;
    sheet.addEventListener('mousedown', function (e) {
      if (reduce) return;
      if (e.target.closest('button, a, input, .rd, summary, .photo, .envelope, .pin, .badge, .sign-flow > div')) return;
      var d = document.createElement('span');
      var s = 10 + Math.random() * 12;
      d.className = 'ink-dot';
      d.style.cssText = 'left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:' + s + 'px;height:' + s + 'px';
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 1000);
    });
  }

  function initGlobalEvents() {
    window.__CX_GET_CLEARANCE__ = function () { return state.clearance; };
    document.addEventListener('click', function (e) {
      var r = e.target.closest('.rd');
      if (r) toggleRd(r);
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.classList && e.target.classList.contains('rd') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); toggleRd(e.target);
      }
    });

    $$('#clearPick button').forEach(function (b) {
      b.addEventListener('click', function () { setClear(+b.dataset.lv); });
    });

    $('#copyId').addEventListener('click', function () {
      var text = this.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('项目编号已复制：' + text); }, function () { toast('复制失败，请手动选择。', true); });
      } else {
        toast('当前环境不支持剪贴板，请手动选择。', true);
      }
    });

    $('#printBtn').addEventListener('click', function () {
      $$('.rv').forEach(function (el) { el.classList.add('is-in'); });
      $$('details.acc').forEach(function (d) { d.open = true; });
      setTimeout(function () { window.print(); }, 60);
    });
    window.addEventListener('beforeprint', function () {
      $$('.rv').forEach(function (el) { el.classList.add('is-in'); });
      $$('details.acc').forEach(function (d) { d.open = true; });
    });

    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key.toLowerCase();
      if (/^[1-5]$/.test(k)) setClear(+k);
      else if (k === 't') $('#themeBtn').click();
      else if (k === 'b') $('#breachBtn').click();
      else if (k === 'p') $('#printBtn').click();
      else if (k === 'escape') {
        $('#lightbox').classList.remove('is-on');
        if (window.__CX_SET_BREACH__) window.__CX_SET_BREACH__(false);
        if (window.CXcloseNav) window.CXcloseNav();
      }
    });
  }

  /* ==================== 页脚 / 页码 ==================== */

  function initFooter(d) {
    var id = d.identity || {};
    var footFile = [id.code, id.filed].filter(Boolean).join(' · ');
    setText('footFile', footFile || '—');
    setTimeout(function () {
      var sheet = $('#sheet');
      var pages = sheet ? Math.max(1, Math.ceil(sheet.scrollHeight / 1123)) : 1;
      setText('pageTotal', pages);
      setText('footTotal', pages);
      setText('footPage', 1);
    }, 120);
  }

  /* ==================== 启动 ==================== */

  async function boot() {
    var data;
    try {
      data = await loadJSON('data/archive.json');
    } catch (e) {
      renderFatal(e);
      initGate();
      initTheme();
      initBreach();
      return;
    }

    data = normalize(data);
    state.diagnostics = softCheck(data);

    applyIdentity(data);

    await mountModules(data);

    var sheet = $('#sheet');
    sheet.dataset.mountedModules = state.mounted.join(',');
    sheet.dataset.ignoredModules = state.ignored.join(',');
    sheet.dataset.declaredModules = state.declared.join(',');
    sheet.dataset.emptyModules = state.empty.join(',');
    sheet.dataset.unmountedModules = state.unmounted.join(',');
    sheet.dataset.structure = state.structureUsed ? 'custom' : 'default';
    sheet.dataset.normalizedFixes = String(state.normalized.length);

    window.__ARCHIVE_STATE__ = {
      declared: state.declared.slice(),
      mounted: state.mounted.slice(),
      ignored: state.ignored.slice(),
      failed: state.failed.slice(),
      empty: state.empty.slice(),
      unmounted: state.unmounted.slice(),
      normalized: state.normalized.slice(),
      diagnostics: state.diagnostics,
      structureUsed: state.structureUsed,
      sections: $$('.sec').length,
      appendixLetters: $$('.sec__title').map(function (h) {
        var m = /附录 ([A-Z])/.exec(h.textContent || '');
        return m ? m[1] : null;
      }).filter(Boolean)
    };

    prepareRedactions();
    setClear(state.clearance, true);
    initTabs();
    drawRadar();
    initHume();
    initGate();
    initTheme();
    initBreach();
    initNav();
    initScroll();
    initInkDots();
    initGlobalEvents();
    initFooter(data);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
