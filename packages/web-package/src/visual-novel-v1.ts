import { z } from 'zod';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

// The client CSP does not permit Zod's optional Function-constructor optimization.
z.config({ jitless: true });

// This revision is retained for replay. Publish a new revision instead of replacing its bytes.
export const BUILTIN_VISUAL_NOVEL_PACKAGE_REF: Readonly<WebPackageRef> = Object.freeze({
  id: 'mahoshojo.visual-novel-lite',
  version: '1.0.0',
  digest: 'sha256:c04d82583f2530d56068b20de2ead8dcafffeecba9bb2f90d9c5f5ab07092257',
});

export const VisualNovelStorySchema = z.object({
  title: z.string().min(1).max(200),
  scenes: z.array(z.object({
    speaker: z.string().max(100).optional(),
    text: z.string().min(1).max(12000),
  }).strict()).min(1).max(128),
}).strict();

export const STORY_LOADER = "fetch('data/story.json').then((response) => { if (!response.ok) throw new Error('story unavailable'); return response.json(); })";

const runtime = `/* Visual Novel Lite 1.0.0 — immutable first-party runtime */
(() => {
  'use strict';
  const title = document.getElementById('story-title');
  const speaker = document.getElementById('speaker');
  const text = document.getElementById('story-text');
  const progress = document.getElementById('progress');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  ${STORY_LOADER}.then((story) => {
    let index = 0;
    title.textContent = story.title;
    function show() {
      const scene = story.scenes[index];
      speaker.textContent = scene.speaker || '旁白';
      text.textContent = scene.text;
      progress.textContent = (index + 1) + ' / ' + story.scenes.length;
      previous.disabled = index === 0;
      next.disabled = index === story.scenes.length - 1;
    }
    previous.addEventListener('click', () => { if (index > 0) { index--; show(); } });
    next.addEventListener('click', () => { if (index < story.scenes.length - 1) { index++; show(); } });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') previous.click();
      if (event.key === 'ArrowRight') next.click();
    });
    show();
  }).catch(() => { text.textContent = '故事暂时无法载入，请返回普通文本查看。'; });
})();`;

export const VISUAL_NOVEL_FILES: ReadonlyArray<Readonly<{ path: string; mediaType: string; content: string }>> = [
  {
    path: 'index.html', mediaType: 'text/html',
    content: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual Novel Lite</title><link rel="stylesheet" href="styles/app.css"></head><body><main><header><span class="eyebrow">MAHOSHOJO · VISUAL NOVEL</span><h1 id="story-title">故事舞台</h1></header><section class="scene" aria-label="故事"><img class="backdrop" src="assets/backdrop.svg" alt=""><div class="dialogue" aria-live="polite"><p id="speaker">旁白</p><p id="story-text">故事载入中…</p></div></section><nav aria-label="故事翻页"><button id="previous" type="button" disabled>← 上一幕</button><span id="progress" aria-live="polite"></span><button id="next" type="button" disabled>下一幕 →</button></nav><footer>使用左右方向键翻页 · 故事页面不改变正式裁定</footer></main><script src="runtime/app.js"></script></body></html>`,
  },
  {
    path: 'styles/app.css', mediaType: 'text/css',
    content: `:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#121325;color:#f9f5ff}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,44px)}main{max-width:860px;margin:auto}.eyebrow{font-size:11px;letter-spacing:.2em;color:#c4b5e5}h1{font-size:clamp(22px,4vw,36px);font-weight:600;margin:12px 0 26px}.scene{position:relative;min-height:370px;overflow:hidden;border-radius:18px;border:1px solid #555071}.backdrop{position:absolute;width:100%;height:100%;object-fit:cover}.dialogue{position:relative;margin-top:140px;padding:26px;background:linear-gradient(transparent,#141226 22%);min-height:230px}#speaker{color:#e7caff;font-weight:600}#story-text{white-space:pre-wrap;line-height:1.85;font-size:17px;margin:10px 0}nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px}button{font:inherit;color:inherit;background:#34304e;border:1px solid #78688e;border-radius:9px;padding:10px 16px;cursor:pointer}button:hover{background:#443c60}button:focus-visible{outline:2px solid #ead8ff;outline-offset:4px}button:disabled{opacity:.35;cursor:default}#progress,footer{font-size:12px;color:#b9afc7}footer{margin-top:22px;text-align:center}@media(prefers-reduced-motion:no-preference){button{transition:background .15s}}`,
  },
  { path: 'runtime/app.js', mediaType: 'text/javascript', content: runtime },
  {
    path: 'assets/backdrop.svg', mediaType: 'image/svg+xml',
    content: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#403758"/><stop offset="1" stop-color="#171a32"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1200v640H0z"/><circle cx="910" cy="135" r="65" fill="#e7cbd8" opacity=".8"/><path d="M0 310 180 190 350 380 540 220 770 410 1030 250 1200 350V640H0Z" fill="#26253e"/><path d="M0 430 270 350 470 460 710 340 900 430 1200 330V640H0Z" fill="#161a2e"/></svg>',
  },
  {
    path: 'data/story.json', mediaType: 'application/json',
    content: '{"title":"等待故事开启","scenes":[{"speaker":"旁白","text":"舞台已准备好，新的故事即将开始。"}]}',
  },
  {
    path: 'ai/instructions.md', mediaType: 'text/markdown',
    content: '将本次 Arena 故事写为 Visual Novel Lite 的连续场景。仅输出 JSON：title 与 scenes 数组；每幕包含 text，可选 speaker。保留角色身份、事实与正式裁定；场景按发生顺序推进，台词和旁白均可独立成幕。舞台、翻页和排版由固定 Runtime 完成，无需生成 HTML、CSS、JavaScript 或资源。',
  },
  {
    path: 'ai/assets.json', mediaType: 'application/json',
    content: '{"assets":[{"id":"twilight-stage","purpose":"固定暮色山景舞台，由 Runtime 展示，无需生成或引用文件内容。"}]}',
  },
  {
    path: 'schemas/story.schema.json', mediaType: 'application/json',
    // Freeze the emitted JSON bytes as well; upgrading Zod must not change historical package identity.
    content: '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":200},"scenes":{"type":"array","items":{"type":"object","properties":{"speaker":{"type":"string","maxLength":100},"text":{"type":"string","minLength":1,"maxLength":12000}},"required":["text"],"additionalProperties":false},"minItems":1,"maxItems":128}},"required":["title","scenes"],"additionalProperties":false}',
  },
];
