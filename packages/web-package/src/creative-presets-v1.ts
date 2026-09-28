import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

// Published bytes are immutable. A content change requires a new retained revision.
export const FORUM_PACKAGE_REF: Readonly<WebPackageRef> = Object.freeze({ id: 'mahoshojo.starlight-forum', version: '1.0.0', digest: 'sha256:db0b1bfdba6520dabbd4b00c342c3e916311f3f2898ed210a11d84b127d7fd15' });
export const CHOICE_PACKAGE_REF: Readonly<WebPackageRef> = Object.freeze({ id: 'mahoshojo.crossroads', version: '1.0.0', digest: 'sha256:db441d96537815eb37375bd3537df765552034893829475d6bc60cbe52c77f4f' });
const text = (maxLength = 4000) => ({ type: 'string', minLength: 1, maxLength });
const array = (items: unknown, minItems: number, maxItems: number) => ({ type: 'array', items, minItems, maxItems });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const forumSchema = object({ title: text(120), subtitle: text(400), posts: array(object({ title: text(180), author: text(80), category: text(40), body: text(6000), replies: array(object({ author: text(80), text: text(1500) }), 1, 12) }), 3, 24) });
const choiceSchema = object({ title: text(120), introduction: text(1200), challenges: array(object({ title: text(160), scene: text(4000), choices: array(object({ label: text(180), feedback: text(1500), points: { type: 'integer', minimum: 0, maximum: 2 } }), 2, 4) }), 3, 12), endings: object({ thoughtful: text(2000), bold: text(2000), exploratory: text(2000) }) });
const LOADER = "fetch('data/story.json').then((r) => { if (!r.ok) throw new Error('story unavailable'); return r.json(); })";
const helpers = `const root = document.getElementById('app');
function node(tag, value, className) { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; if (className) el.className = className; return el; }
function button(label, action) { const el = node('button', label); el.type = 'button'; el.addEventListener('click', action); return el; }
function focusHeading() { const el = root.querySelector('h2'); if (el) { el.tabIndex = -1; el.focus(); } }
function header(kicker, title, subtitle) { const el = node('header'); el.append(node('p', kicker, 'eyebrow'), node('h1', title), node('p', subtitle, 'subtitle')); return el; }
`;
const forumRuntime = `(() => { 'use strict'; ${helpers}
${LOADER}.then((story) => {
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
}).catch(() => { root.textContent = '社区内容未能载入，请返回安全文本查看。'; }); })();`;
const choiceRuntime = `(() => { 'use strict'; ${helpers}
${LOADER}.then((story) => {
let index = 0; let score = 0; let selected = null; const history = [];
root.append(header('CROSSROADS / INTERACTIVE STORY', story.title, story.introduction)); const stage = node('section', undefined, 'stage'); root.append(stage);
function render() { stage.replaceChildren();
 if (index === story.challenges.length) { const ratio = score / (story.challenges.length * 2); const ending = ratio >= .7 ? story.endings.thoughtful : ratio >= .35 ? story.endings.bold : story.endings.exploratory;
 stage.append(node('p', '旅程完成 · ' + score + ' / ' + story.challenges.length * 2 + ' 洞察点', 'eyebrow'), node('h2', '你走出的这条路'), node('p', ending, 'prose')); const log = node('details'); log.append(node('summary', '回看我的选择')); history.forEach((item) => log.append(node('p', item, 'prose'))); stage.append(log, button('重新探索另一种选择', () => { index = 0; score = 0; selected = null; history.length = 0; render(); focusHeading(); })); return; }
 const challenge = story.challenges[index]; stage.append(node('p', '决策 ' + (index + 1) + ' / ' + story.challenges.length, 'eyebrow')); const meter = node('progress'); meter.max = story.challenges.length; meter.value = index; meter.setAttribute('aria-label', '旅程进度'); stage.append(meter, node('h2', challenge.title), node('p', challenge.scene, 'prose'));
 const choices = node('div', undefined, 'choices'); challenge.choices.forEach((choice, i) => { const el = button(String.fromCharCode(65 + i) + ' / ' + choice.label, () => { if (selected !== null) return; selected = i; score += choice.points; history.push(challenge.title + ' → ' + choice.label); render(); const feedback = stage.querySelector('.feedback'); feedback.focus(); }); el.disabled = selected !== null; el.className = selected === i ? 'chosen' : ''; choices.append(el); }); stage.append(choices);
 if (selected !== null) { const response = node('div', undefined, 'feedback'); response.tabIndex = -1; response.setAttribute('role', 'status'); response.append(node('h3', '选择的回声'), node('p', challenge.choices[selected].feedback, 'prose')); stage.append(response, button(index === story.challenges.length - 1 ? '查看我的旅程' : '继续前行 →', () => { index++; selected = null; render(); focusHeading(); })); }
} render();
}).catch(() => { root.textContent = '旅程未能载入，请返回安全文本查看。'; }); })();`;
const css = `:root{font-family:ui-sans-serif,system-ui,sans-serif;color:#243833;background:#f3f5ef;line-height:1.6;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,44px)}main{max-width:940px;margin:auto}header{padding:28px 0 34px;border-bottom:1px solid #becdc4;margin-bottom:24px}h1{font-family:Georgia,serif;font-size:clamp(30px,6vw,56px);line-height:1.18;letter-spacing:-.035em;margin:14px 0}h2{font-size:26px;line-height:1.3}h3{line-height:1.4}.eyebrow,.meta{font-size:12px;letter-spacing:.04em;color:#486459}.eyebrow{font-weight:750;letter-spacing:.13em}.subtitle{max-width:650px;color:#486459}.tools{display:flex;gap:12px;margin:24px 0}input,select,button{font:inherit;border:1px solid #acbeb3;border-radius:9px;padding:12px 16px;color:inherit;background:#fff}input{min-width:0;flex:1}button{cursor:pointer}button:hover:not(:disabled){border-color:#246b51;background:#edf5ef}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #397c63;outline-offset:3px}button:disabled{cursor:default;opacity:.65}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:16px}.post{display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:24px;min-height:245px}.post h3{font-size:20px;margin:16px 0 8px}.preview{color:#486459;flex:1}.tag{font-size:11px;border-radius:20px;background:#e3ede4;padding:4px 10px}.detail,.stage{background:#fff;border:1px solid #c8d6ca;border-radius:14px;padding:clamp(20px,4vw,40px);margin-top:20px}.prose{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9}.reply{border-top:1px solid #dce4dd;padding:14px 0}.choices{display:grid;gap:12px;margin:26px 0}.choices button{text-align:left}.choices .chosen{background:#d8eadd;border-color:#276b4d;opacity:1}.feedback{border-left:4px solid #b67740;background:#faf3e8;padding:16px 22px;margin:24px 0}progress{width:100%;height:6px;accent-color:#326d53}details{padding:18px 0}summary{cursor:pointer}footer{font-size:12px;color:#536b5e;padding:28px 0;text-align:center}h1,h2,h3,.meta{overflow-wrap:anywhere}@media(max-width:480px){.tools{flex-direction:column}}`;
export const FORUM_SAMPLE = { title: '星屑广场', subtitle: '任务结束后，大家在这里交换见闻。', posts: [
 { title: '今晚钟楼的光，是谁留下的？', author: '巡夜人', category: '现场见闻', body: '钟楼已经恢复安静。路过时看见一束小小的光，像是有人把胜利留给了整座城。', replies: [{ author: '修补匠', text: '是修复结界时留下的标记，明早就会消散。' }] },
 { title: '失物招领：一枚月亮发夹', author: '便利店店员', category: '城中日常', body: '发夹夹在收据里。拾到地点是车站门口，失主可以凭今天的故事认领。', replies: [{ author: '见习魔女', text: '是我的！当时跑得太急，谢谢你。' }] },
 { title: '战后热可可互助站', author: '夜班厨师', category: '城中日常', body: '给守护城市的人留一盏灯，也留一杯热可可。', replies: [{ author: '巡夜人', text: '我负责把大家带过来。' }] },
] };
export const CHOICE_SAMPLE = { title: '钟楼之后的岔路', introduction: '三次小小的选择，试着理解角色如何守护这座城。', challenges: [
 { title: '微弱的求救', scene: '钟声停止了，你听见废墟后传来声音。', choices: [{ label: '先观察并呼叫同伴', feedback: '同伴确定了安全路线，你们一起找到了被困的信使。', points: 2 }, { label: '循着声音冲过去', feedback: '你及时回应了求救，但绕过坍塌的墙又花了一些时间。', points: 1 }] },
 { title: '信使的包裹', scene: '信使拜托你把一封信交给车站的守夜人。', choices: [{ label: '确认收件信息再出发', feedback: '原来守夜人今晚换了岗，你找到了正确的站台。', points: 2 }, { label: '先去车站问问', feedback: '你在问路途中听到了另一位旅人的故事。', points: 0 }] },
 { title: '最后一盏灯', scene: '信已送到，守夜人邀请你留下一句话。', choices: [{ label: '写下今天帮助过你的人', feedback: '大家的名字留下了，一次冒险成为共同的回忆。', points: 2 }, { label: '画一颗新的星星', feedback: '星星亮在纸上，为陌生人带来一个微小的惊喜。', points: 1 }] },
], endings: { thoughtful: '你留心每个细节，让一路遇见的人彼此连接。城市记住了这份温柔。', bold: '你用行动回应求助，偶尔绕路，却也带回了意外的故事。', exploratory: '你走出了一条自己的路。那些偶遇会成为下次出发时的线索。' } };
function files(title: string, runtime: string, schema: unknown, sample: unknown, instructions: string) {
 return [
 { path: 'index.html', mediaType: 'text/html', content: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles/app.css"></head><body><main id="app"></main><footer>虚构角色体验 · 交互只在当前页面生效，不改变正式故事裁定</footer><script src="runtime/app.js"></script></body></html>` },
 { path: 'styles/app.css', mediaType: 'text/css', content: css }, { path: 'runtime/app.js', mediaType: 'text/javascript', content: runtime },
 { path: 'data/story.json', mediaType: 'application/json', content: JSON.stringify(sample) },
 { path: 'schemas/story.schema.json', mediaType: 'application/json', content: JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema as object }) },
 { path: 'ai/instructions.md', mediaType: 'text/markdown', content: instructions },
 ];
}
export const FORUM_FILES = files('星屑社区', forumRuntime, forumSchema, FORUM_SAMPLE, '将本场角色与情景创作为虚构社区。仅生成满足schema的JSON。title/subtitle为社区名称和简介；生成6至12条不同主题帖子，每条有角色化author、category、body和2至6条有来有回的replies。通过目击、讨论、日常和不同角色口吻展现完整故事，保留正式事实与winner，不伪造现实平台或真实用户。不要输出HTML或脚本。搜索、分类、收藏和详情由固定runtime实现，无需编写UI。');
export const CHOICE_FILES = files('命运岔路', choiceRuntime, choiceSchema, CHOICE_SAMPLE, '将本场角色与情景创作为可重玩的情境抉择小游戏。仅生成满足schema的JSON。生成4至8个连续挑战，每个challenge有title、scene以及2至4个choices。每个choice有label、具体且不同的feedback和0/1/2洞察点points；每题至少有两种不同分数。得分衡量体察情境，不代表道德优劣。endings提供thoughtful（得分比例>=70%）、bold（>=35%）、exploratory三种具体不同的旅程回顾。挑战顺序固定，各选项在下一题前汇合，避免需要前一选择才能成立的剧情；这是既定故事内的互动番外，不改写正式winner或权威事实。不得输出HTML或脚本。');

/** Only these pinned first-party runtimes are inlined; this is not a generic resource resolver. */
export function materializeCreativePreset(readFile: (_path: string) => Uint8Array | undefined, storyJson: string): string {
 const read = (path: string) => { const bytes = readFile(path); if (!bytes) throw new Error(`Web Package 文件不存在：${path}`); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); };
 const runtime = read('runtime/app.js').replace(LOADER, "Promise.resolve(JSON.parse(document.getElementById('web-package-story').textContent))");
 return read('index.html').replace('<link rel="stylesheet" href="styles/app.css">', () => `<style>${read('styles/app.css')}</style>`).replace('<script src="runtime/app.js"></script>', () => `<script type="application/json" id="web-package-story">${storyJson.replace(/</gu, '\\u003c')}</script><script>${runtime}</script>`);
}
