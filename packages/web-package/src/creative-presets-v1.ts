import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

// Published bytes are immutable. A content change requires a new retained revision.
export const FORUM_PACKAGE_REF: Readonly<WebPackageRef> = Object.freeze({ id: 'mahoshojo.starlight-forum', version: '1.0.0', digest: 'sha256:db0b1bfdba6520dabbd4b00c342c3e916311f3f2898ed210a11d84b127d7fd15' });
export const CHOICE_PACKAGE_REF: Readonly<WebPackageRef> = Object.freeze({ id: 'mahoshojo.crossroads', version: '1.0.0', digest: 'sha256:db441d96537815eb37375bd3537df765552034893829475d6bc60cbe52c77f4f' });
const LOADER = "fetch('data/story.json').then((r) => { if (!r.ok) throw new Error('story unavailable'); return r.json(); })";

/** Only these pinned first-party runtimes are inlined; this is not a generic resource resolver. */
export function materializeCreativePreset(readFile: (_path: string) => Uint8Array | undefined, storyJson: string): string {
 const read = (path: string) => { const bytes = readFile(path); if (!bytes) throw new Error(`Web Package 文件不存在：${path}`); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); };
 const runtime = read('runtime/app.js').replace(LOADER, "Promise.resolve(JSON.parse(document.getElementById('web-package-story').textContent))");
 return read('index.html').replace('<link rel="stylesheet" href="styles/app.css">', () => `<style>${read('styles/app.css')}</style>`).replace('<script src="runtime/app.js"></script>', () => `<script type="application/json" id="web-package-story">${storyJson.replace(/</gu, '\\u003c')}</script><script>${runtime}</script>`);
}
