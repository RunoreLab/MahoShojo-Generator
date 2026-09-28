(() => { 'use strict'; const root = document.getElementById('app');
function node(tag, value, className) { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; if (className) el.className = className; return el; }
function button(label, action) { const el = node('button', label); el.type = 'button'; el.addEventListener('click', action); return el; }
function focusHeading() { const el = root.querySelector('h2'); if (el) { el.tabIndex = -1; el.focus(); } }
function header(kicker, title, subtitle) { const el = node('header'); el.append(node('p', kicker, 'eyebrow'), node('h1', title), node('p', subtitle, 'subtitle')); return el; }

fetch('data/story.json').then((r) => { if (!r.ok) throw new Error('story unavailable'); return r.json(); }).then((story) => {
let index = 0; let score = 0; let selected = null; const history = [];
root.append(header('CROSSROADS / INTERACTIVE STORY', story.title, story.introduction)); const stage = node('section', undefined, 'stage'); root.append(stage);
function render() { stage.replaceChildren();
 if (index === story.challenges.length) { const ratio = score / (story.challenges.length * 2); const ending = ratio >= .7 ? story.endings.thoughtful : ratio >= .35 ? story.endings.bold : story.endings.exploratory;
 stage.append(node('p', '旅程完成 · ' + score + ' / ' + story.challenges.length * 2 + ' 洞察点', 'eyebrow'), node('h2', '你走出的这条路'), node('p', ending, 'prose')); const log = node('details'); log.append(node('summary', '回看我的选择')); history.forEach((item) => log.append(node('p', item, 'prose'))); stage.append(log, button('重新探索另一种选择', () => { index = 0; score = 0; selected = null; history.length = 0; render(); focusHeading(); })); return; }
 const challenge = story.challenges[index]; stage.append(node('p', '决策 ' + (index + 1) + ' / ' + story.challenges.length, 'eyebrow')); const meter = node('progress'); meter.max = story.challenges.length; meter.value = index; meter.setAttribute('aria-label', '旅程进度'); stage.append(meter, node('h2', challenge.title), node('p', challenge.scene, 'prose'));
 const choices = node('div', undefined, 'choices'); challenge.choices.forEach((choice, i) => { const el = button(String.fromCharCode(65 + i) + ' / ' + choice.label, () => { if (selected !== null) return; selected = i; score += choice.points; history.push(challenge.title + ' → ' + choice.label); render(); const feedback = stage.querySelector('.feedback'); feedback.focus(); }); el.disabled = selected !== null; el.className = selected === i ? 'chosen' : ''; choices.append(el); }); stage.append(choices);
 if (selected !== null) { const response = node('div', undefined, 'feedback'); response.tabIndex = -1; response.setAttribute('role', 'status'); response.append(node('h3', '选择的回声'), node('p', challenge.choices[selected].feedback, 'prose')); stage.append(response, button(index === story.challenges.length - 1 ? '查看我的旅程' : '继续前行 →', () => { index++; selected = null; render(); focusHeading(); })); }
} render();
}).catch(() => { root.textContent = '旅程未能载入，请返回安全文本查看。'; }); })();