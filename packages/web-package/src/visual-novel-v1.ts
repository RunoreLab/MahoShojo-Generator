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

const STORY_LOADER = "fetch('data/story.json').then((response) => { if (!response.ok) throw new Error('story unavailable'); return response.json(); })";

const STORY_SCRIPT_ID = 'web-package-story';

const toDataUrl = (mediaType: string, bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mediaType};base64,${btoa(binary)}`;
};

/** Visual Novel Lite-only srcdoc materializer; generic core must not learn these paths. */
export const materializeVisualNovelHtml = (
  readFile: (_path: string) => Uint8Array | undefined,
  storyJson: string,
): string => {
  const read = (path: string): string => {
    const bytes = readFile(path);
    if (!bytes) throw new Error(`Web Package 文件不存在：${path}`);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  };
  const runtime = read('runtime/app.js')
    .replace(STORY_LOADER, `Promise.resolve(JSON.parse(document.getElementById('${STORY_SCRIPT_ID}').textContent))`);
  const backdrop = toDataUrl('image/svg+xml', readFile('assets/backdrop.svg')!);
  return read('index.html')
    .replace('<link rel="stylesheet" href="styles/app.css">', `<style>${read('styles/app.css')}</style>`)
    .replace('src="assets/backdrop.svg"', `src="${backdrop}"`)
    .replace('<script src="runtime/app.js"></script>', () => (
      `<script type="application/json" id="${STORY_SCRIPT_ID}">${storyJson.replace(/</gu, '\\u003c')}</script><script>${runtime}</script>`
    ));
};
