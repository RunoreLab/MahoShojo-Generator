(() => { 'use strict'; const root = document.getElementById('app');
function node(tag, value, className) { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; if (className) el.className = className; return el; }
function button(label, action) { const el = node('button', label); el.type = 'button'; el.addEventListener('click', action); return el; }
function focusHeading() { const el = root.querySelector('h2'); if (el) { el.tabIndex = -1; el.focus(); } }
function header(kicker, title, subtitle) { const el = node('header'); el.append(node('p', kicker, 'eyebrow'), node('h1', title), node('p', subtitle, 'subtitle')); return el; }

fetch('data/story.json').then((r) => { if (!r.ok) throw new Error('story unavailable'); return r.json(); }).then((story) => {
const liked = new Set(); let query = ''; let category = ''; let detail = null;
const banner = header('STARLIGHT / COMMUNITY', story.title, story.subtitle);
const body = node('section'); root.append(banner, body);
function render() { body.replaceChildren();
 if (detail !== null) { const post = story.posts[detail]; body.append(button('← 返回话题广场', () => { detail = null; render(); focusHeading(); })); const article = node('article', undefined, 'detail'); article.append(node('p', post.category + ' · ' + post.author, 'meta'), node('h2', post.title), node('p', post.body, 'prose'));
 const like = button(liked.has(detail) ? '♥ 已收藏' : '♡ 收藏话题', () => { if (liked.has(detail)) liked.delete(detail); else liked.add(detail); like.textContent = liked.has(detail) ? '♥ 已收藏' : '♡ 收藏话题'; like.setAttribute('aria-pressed', String(liked.has(detail))); }); like.setAttribute('aria-pressed', String(liked.has(detail))); article.append(like, node('h3', '话题回复 · ' + post.replies.length));
 post.replies.forEach((reply, i) => { const el = node('section', undefined, 'reply'); el.append(node('p', String(i + 1).padStart(2, '0') + ' / ' + reply.author, 'meta'), node('p', reply.text, 'prose')); article.append(el); }); body.append(article); return; }
 body.append(node('h2', '话题广场'));
 const tools = node('div', undefined, 'tools'); const search = node('input'); search.type = 'search'; search.placeholder = '搜索角色、话题或线索'; search.setAttribute('aria-label', '搜索话题'); search.value = query;
 const select = node('select'); select.setAttribute('aria-label', '话题分类'); ['', ...new Set(story.posts.map((p) => p.category))].forEach((v) => { const option = node('option', v || '全部分类'); option.value = v; select.append(option); }); select.value = category;
 tools.append(search, select); body.append(tools); const count = node('p', '', 'meta'); count.setAttribute('aria-live', 'polite'); const grid = node('div', undefined, 'grid'); body.append(count, grid);
 function list() { grid.replaceChildren(); let shown = 0; story.posts.forEach((post, index) => { if ((category && category !== post.category) || !(post.title + post.author + post.body).toLocaleLowerCase().includes(query.toLocaleLowerCase())) return; shown++; const card = button('', () => { detail = index; render(); focusHeading(); }); card.className = 'post'; card.append(node('span', post.category, 'tag'), node('h3', post.title), node('p', post.body.slice(0, 100), 'preview'), node('span', post.author + ' · ' + post.replies.length + ' 条回复' + (liked.has(index) ? ' · ♥' : ''), 'meta')); grid.append(card); }); count.textContent = shown ? shown + ' 个话题 · 点击阅读完整讨论' : '没有找到话题，试试其他关键词。'; }
 search.addEventListener('input', () => { query = search.value; list(); }); select.addEventListener('change', () => { category = select.value; list(); }); list();
} render();
}).catch(() => { root.textContent = '社区内容未能载入，请返回安全文本查看。'; }); })();