// @vitest-environment jsdom
// 角色管理页共源产品区段的宿主无关契约（D5.1-P2-r5，DESK-PARITY-001/005）。
// Web 与 Desktop 注入同一组组件不同的能力快照与动作——这里钉住共享面本身的
// 结构、能力门控与草稿/名称辅助语义；宿主接线测试在各自 app 下进行。

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE,
  CharacterManagerAccountPanel,
  CharacterManagerDraftBar,
  CharacterManagerEditorActions,
  formatCharacterManagerRestoredDraftMessage,
  CharacterManagerGuide,
  CharacterManagerImportSection,
  CharacterManagerPageHeader,
  CharacterManagerTemplateSelect,
  cardTopName,
  extractCardBaseName,
  nameReplacePreservesNativeness,
  replaceAllNamesInData,
  shouldOfferNameReplace,
  type CharacterManagerCapabilities,
} from '../src/character-manager';
import {
  buildCharacterManagerPageDraftPayload,
  restoreCharacterManagerPageDraft,
} from '../src/character-manager/page-draft';

const ALL_ON: CharacterManagerCapabilities = {
  cloudCards: 'manage',
  tachie: true,
  questionnaireEditor: true,
  templateSelect: true,
  nativenessInfo: true,
  sensitiveWords: true,
  scenarioEditors: true,
};

const DESKTOP_SNAPSHOT: CharacterManagerCapabilities = {
  cloudCards: 'browse',
  tachie: false,
  questionnaireEditor: false,
  templateSelect: true,
  nativenessInfo: false,
  sensitiveWords: false,
  scenarioEditors: true,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: ReactNode): void => {
  act(() => root.render(node));
};

describe('CharacterManagerPageHeader', () => {
  it('默认渲染双主题品牌 Logo、副标题与宿主插槽', () => {
    render(
      <CharacterManagerPageHeader notice={<div>提示条</div>}>
        <div>账号区</div>
      </CharacterManagerPageHeader>,
    );
    const images = [...container.querySelectorAll('img')];
    expect(images.map((item) => item.getAttribute('src'))).toEqual([
      '/character-manager.svg',
      '/character-manager-white.svg',
    ]);
    expect(container.textContent).toContain('在这里查看、编辑和维护你的角色档案');
    expect(container.textContent).toContain('提示条');
    expect(container.textContent).toContain('账号区');
  });
});

describe('CharacterManagerAccountPanel', () => {
  it('登录分支渲染欢迎行、宿主动作与「我的数据卡」槽位计数', () => {
    const onOpen = vi.fn();
    render(
      <CharacterManagerAccountPanel
        status="authenticated"
        userDisplay={<span>测试用户</span>}
        actions={<button>退出登录</button>}
        myDataCards={{ onOpen, usedSlots: 2, capacity: 10 }}
      />,
    );
    expect(container.textContent).toContain('欢迎回来，');
    expect(container.textContent).toContain('测试用户');
    const cta = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('我的数据卡'))!;
    expect(cta.textContent).toContain('(2/10 槽)');
    act(() => { cta.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('未登录分支渲染宿主文案、登录动作与可选的我的数据卡入口（Desktop 始终给）', () => {
    const onAction = vi.fn();
    const onOpen = vi.fn();
    render(
      <CharacterManagerAccountPanel
        status="unauthenticated"
        signedOut={{ text: '本地编辑不需要登录', actionLabel: '登录', onAction }}
        myDataCards={{ onOpen }}
      />,
    );
    expect(container.textContent).toContain('本地编辑不需要登录');
    act(() => {
      [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === '登录')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('我的数据卡');
  });

  it('loading 分支只渲染加载文案', () => {
    render(<CharacterManagerAccountPanel status="loading" />);
    expect(container.textContent).toContain('加载中...');
    expect(container.textContent).not.toContain('我的数据卡');
  });
});

describe('CharacterManagerGuide', () => {
  it('能力快照未交付的条目不渲染（Desktop：立绘/问卷编辑器/原生性）', () => {
    render(
      <CharacterManagerGuide
        capabilities={DESKTOP_SNAPSHOT}
        saveAndExportText="保存写入本地库。"
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('加载角色');
    expect(text).toContain('一键换名');
    expect(text).toContain('编辑情景');
    expect(text).not.toContain('立绘');
    expect(text).not.toContain('问卷编辑器');
    expect(text).not.toContain('原生数据');
  });

  it('Web 快照交付全部条目（立绘/问卷编辑器/原生性说明）', () => {
    render(
      <CharacterManagerGuide
        capabilities={ALL_ON}
        saveAndExportText="可下载新的 .json 文件或将内容复制到剪贴板。"
        linkComponent={({ href, className, children }) => <a href={href} className={className}>{children}</a>}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('立绘');
    expect(text).toContain('问卷编辑器');
    expect(text).toContain('原生数据');
    expect(container.querySelector('a[href="/questionnaire-editor"]')).not.toBeNull();
  });
});

describe('CharacterManagerTemplateSelect', () => {
  it('未知模板渲染占位项，选择模板回调 onSelect', () => {
    const onSelect = vi.fn();
    render(<CharacterManagerTemplateSelect value="unknown" hasContent={false} onSelect={onSelect} />);
    const select = container.querySelector('select')!;
    expect(select.value).toBe(CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE);
    expect(container.textContent).toContain('选择模板以创建空白内容');

    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')!.set!;
    act(() => {
      setter.call(select, 'magical-girl');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('magical-girl');
  });
});

describe('CharacterManagerDraftBar', () => {
  it('显示自动保存时间并支持清空回调', () => {
    const onClear = vi.fn();
    render(<CharacterManagerDraftBar savedAt={1_700_000_000_000} onClear={onClear} />);
    expect(container.textContent).toContain('已自动保存于');
    act(() => {
      [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('清空'))!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('CharacterManagerImportSection', () => {
  it('粘贴区可折叠展开，载入按钮透传宿主回调', () => {
    const onPasteLoad = vi.fn();
    const onPasteChange = vi.fn();
    render(
      <CharacterManagerImportSection
        onFile={vi.fn()}
        pasteValue='{"codename":"星光"}'
        onPasteChange={onPasteChange}
        onPasteLoad={onPasteLoad}
      />,
    );
    expect(container.querySelector('textarea')).toBeNull();
    const toggle = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('展开文本粘贴区域'))!;
    act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('textarea')).not.toBeNull();
    act(() => {
      [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('从文本加载数据'))!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPasteLoad).toHaveBeenCalledOnce();
  });
});

describe('名称辅助规则（name-assist）', () => {
  it('基础名提取保留「称号」语义，顶层名 codename 优先', () => {
    expect(cardTopName({ codename: '星光「闪耀」' })).toBe('星光「闪耀」');
    expect(cardTopName({ name: '残兽甲' })).toBe('残兽甲');
    expect(extractCardBaseName('星光「闪耀」')).toBe('星光');
    expect(extractCardBaseName('星光')).toBe('星光');
  });

  it('一键替换覆盖称号部分并递归替换嵌套字段', () => {
    const data = {
      codename: '新月「夜」',
      appearance: { description: '新月「夜」站在新月下' },
      arena_history: { entries: [{ title: '新月「夜」 vs 残兽' }] },
    };
    const next = replaceAllNamesInData(data, '新月', '朝日');
    expect(next.codename).toBe('朝日「夜」');
    expect(next.appearance.description).toBe('朝日「夜」站在朝日下');
    expect(next.arena_history.entries[0].title).toBe('朝日「夜」 vs 残兽');
    // 输入不被原地修改。
    expect(data.codename).toBe('新月「夜」');
  });

  it('仅当原/现顶层名称都存在且不同才提供替换', () => {
    expect(shouldOfferNameReplace({ codename: 'A' }, { codename: 'B' })).toBe(true);
    expect(shouldOfferNameReplace({ codename: 'A' }, { codename: 'A' })).toBe(false);
    expect(shouldOfferNameReplace({}, { codename: 'B' })).toBe(false);
    expect(nameReplacePreservesNativeness('短名')).toBe(true);
    expect(nameReplacePreservesNativeness('超'.repeat(33))).toBe(false);
  });
});

describe('character-manager page-draft 共源封装', () => {
  it('只持久化有效粘贴草稿或完整编辑器草稿，往返可恢复', () => {
    expect(
      buildCharacterManagerPageDraftPayload({ pastedJson: '', characterData: null, originalData: null, isNative: false, selectedTemplate: 'unknown' }),
    ).toBeNull();
    expect(
      buildCharacterManagerPageDraftPayload({ pastedJson: '  ', characterData: null, originalData: null, isNative: false, selectedTemplate: 'unknown' }),
    ).toBeNull();

    const payload = buildCharacterManagerPageDraftPayload({
      pastedJson: '',
      characterData: { codename: '星光' },
      originalData: { codename: '星光' },
      isNative: true,
      selectedTemplate: 'magical-girl',
    })!;
    expect(payload).not.toBeNull();
    const restored = restoreCharacterManagerPageDraft(payload);
    expect(restored?.mode).toBe('editor');
    expect(restored?.characterData).toEqual({ codename: '星光' });
    expect(restored?.selectedTemplate).toBe('magical-girl');
    expect(restored?.isNative).toBe(true);
  });

  it('损坏或版本不符的 payload 不恢复', () => {
    expect(restoreCharacterManagerPageDraft(null)).toBeNull();
    expect(restoreCharacterManagerPageDraft('junk')).toBeNull();
    expect(restoreCharacterManagerPageDraft({ pastedJson: 1 })).toBeNull();
    expect(
      restoreCharacterManagerPageDraft({ pastedJson: '', characterData: 'not-object' }),
    ).toBeNull();
  });
});


describe('CharacterManagerEditorActions', () => {
  it('保存、下载、复制与重新加载回用 Web 的完整动作布局，并调用各宿主动作', () => {
    const actions = { onSaveLocal: vi.fn(), onDownload: vi.fn(), onCopy: vi.fn(), onLoadOtherData: vi.fn() };
    render(<CharacterManagerEditorActions {...actions} cloudActions={<p>云端能力</p>} exportExtra={<p>附加导出</p>} />);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((item) => item.textContent)).toEqual(['保存到本地库', '保存修改并下载', '复制到剪贴板', '加载其他数据']);
    expect(buttons.slice(0, 3).every((item) => item.className === 'generate-button w-full')).toBe(true);
    expect(buttons[2].style.backgroundImage).toContain('rgb(37, 99, 235)');
    expect(buttons[3].className).toBe('footer-link mt-4 w-full text-center');
    for (const item of buttons) act(() => item.click());
    for (const action of Object.values(actions)) expect(action).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('云端能力');
    expect(container.textContent).toContain('附加导出');
  });

  it('保存或导出在途禁止公共动作；保存单独不可用不阻止导出', () => {
    const actions = { onSaveLocal: vi.fn(), onDownload: vi.fn(), onCopy: vi.fn(), onLoadOtherData: vi.fn() };
    for (const busy of [{ localSaveBusy: true }, { exportBusy: true }]) {
      render(<CharacterManagerEditorActions {...actions} {...busy} />);
      expect([...container.querySelectorAll('button')].every((item) => item.disabled)).toBe(true);
    }
    render(<CharacterManagerEditorActions {...actions} localSaveDisabled copied />);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons[0].disabled).toBe(true);
    expect(buttons.slice(1).every((item) => !item.disabled)).toBe(true);
    expect(buttons[2].textContent).toBe('已复制！');
  });

  it('恢复提示使用传入的原草稿时间', () => {
    const timestamp = Date.parse('2026-10-08T08:01:02Z');
    expect(formatCharacterManagerRestoredDraftMessage(timestamp)).toBe(`已恢复本地草稿（${new Date(timestamp).toLocaleTimeString()}）`);
  });
});
