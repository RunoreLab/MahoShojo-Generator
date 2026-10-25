import { useState, type ReactNode } from 'react';
import { Download, ExternalLink, RefreshCw, RotateCw, X } from 'lucide-react';

import { CHARACTER_CARD_EXPORTER_LABEL, MAGICAL_GIRL_CARD_GRADIENT, MagicalGirlCard } from '../character-card';
import { CardForgeThemeEditor, CardForgeSourceFields } from '../card-forge';
import { BattleReportCardWidthSettings } from '../arena/BattleReportCardWidthSettings';
import { resolveBattleReportCardManualWidthPx, type BattleReportCardWidthSettingsValue } from '../arena/battle-report-card-width';
import { CombatantUpdatesPresentation, GeneratedByUserBadgeView, StreamingBattleReportCard } from '../arena-report';
import { ArenaWebResultView, ArenaWebDisplayModeSelectorView, ArenaWebReportActions, ArenaWebImmersiveButton, ArenaWebWindowStatusView, ArenaWebViewer, ARENA_WEB_FRAME_CLASS_NAME, useArenaWebImmersive, type ArenaWebDisplayMode } from '../arena-report/views';
import { BattleStoryBranchChainModal, BattleStoryChapterReader, BattleStorySessionDirectory } from '../arena-story-session';
import { COLOR_MODE_OPTIONS, useColorModePreference } from '../color-mode';
import { ResultJsonCopyButton } from '../details-controls/ResultJsonCopyButton';
import { ErrorMessageBox } from '../details-controls/ErrorMessageBox';
import { ArenaFeedbackView, resolveArenaFeedbackTone } from '../arena/ArenaFeedbackView';
import { AdvancedArenaPageView } from '../arena/AdvancedArenaPageView';
import { BattleLitePageView } from '../arena/BattleLitePageView';
import { GenerationModeSwitcher, type GenerationMode } from '../details-controls/GenerationModeSwitcher';
import { generationActionClassNames } from '../generation-actions';
import { ImageGenerationFeedback, ImageGenerationResultView } from '../image-generation';
import type { HomeAssetSource } from '../home/feature-catalog';
import { BaseModal } from '../modal';
import { ProductFooter } from '../shell';
import { QuestionnaireNavigationActions } from '../questionnaire';
import { ScenarioResultContent } from '../scenario';
import { SHOWROOM_MAGICAL_GIRL } from './fixtures';
import { LocalImagesSample } from './LocalImagesSample';
import { SHOWROOM_SECTIONS, type ShowroomSectionId } from './sections';

export interface ShowroomViewProps {
  /**
   * 宿主品牌资源根（两端当前均为 origin 根 `/`，形状同源但来源各自声明）。
   * 供页脚等展示位拼接站内资源路径。
   */
  assetSource?: HomeAssetSource;
}

const PANEL_CLASS = 'rounded-xl border border-(--app-border) bg-(--app-surface) p-5 shadow-sm';
const SWATCH_CLASS = 'h-14 w-full rounded-md border border-(--app-border)';

function SectionFrame({ id, title, summary, children }: {
  id: ShowroomSectionId;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section id={`showroom-${id}`} className="flex scroll-mt-20 flex-col gap-4" aria-labelledby={`showroom-${id}-title`}>
      <div>
        <h2 id={`showroom-${id}-title`} className="text-lg font-semibold text-(--app-text)">{title}</h2>
        <p className="mt-1 text-sm text-(--app-text-muted)">{summary}</p>
      </div>
      {children}
    </section>
  );
}

function TokenSwatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={SWATCH_CLASS} style={{ background: `var(${token})` }} role="img" aria-label={`${token} 色样`} />
      <code className="text-xs break-all text-(--app-text-muted)">{token}</code>
    </div>
  );
}

const COLOR_GROUPS: ReadonlyArray<{ title: string; tokens: readonly string[] }> = [
  { title: '页面与表面', tokens: ['--app-page-bg', '--app-surface', '--app-surface-80', '--app-surface-60', '--app-surface-40', '--app-border', '--app-border-strong'] },
  { title: '文本', tokens: ['--app-text', '--app-text-muted', '--app-text-subtle'] },
  { title: '输入', tokens: ['--app-input-bg', '--app-input-border'] },
  { title: '强调', tokens: ['--app-accent', '--app-accent-strong', '--app-accent-shadow', '--app-focus-ring'] },
  { title: 'Creator 面板', tokens: ['--creator-panel-bg', '--creator-panel-border', '--creator-subpanel-bg', '--creator-input-bg', '--creator-input-border'] },
  { title: '结果卡', tokens: ['--app-result-card-bg', '--app-result-item-bg', '--app-card-shadow'] },
];

const SPACE_TOKENS = ['--app-space-1', '--app-space-2', '--app-space-3', '--app-space-4', '--app-space-5', '--app-space-6', '--app-space-8', '--app-space-10'] as const;
const RADIUS_TOKENS = ['--app-radius-sm', '--app-radius-md', '--app-radius-lg', '--app-radius-xl', '--app-radius-pill'] as const;
const SHADOW_TOKENS = ['--app-shadow-sm', '--app-shadow-md', '--app-shadow-lg'] as const;
const Z_TOKENS = ['--app-z-overlay', '--app-z-modal', '--app-z-toast'] as const;
const TEXT_TOKENS = ['--app-text-xs', '--app-text-sm', '--app-text-base', '--app-text-lg', '--app-text-xl', '--app-text-2xl'] as const;

function WebViewerSample() {
  const [displayMode, setDisplayMode] = useState<ArenaWebDisplayMode>('web');
  const { immersive, enterImmersive, exitImmersive } = useArenaWebImmersive({ active: displayMode === 'web' });
  return <section className={`${PANEL_CLASS} space-y-3`} aria-label="Web 战报显示与沉浸工具栏样板">
    <ArenaWebDisplayModeSelectorView value={displayMode} onChange={setDisplayMode} />
    {displayMode === 'web' ? <ArenaWebViewer immersive={immersive} onToggleImmersive={immersive ? exitImmersive : enterImmersive}
      aiModel="样板模型" aiUsage={{ promptTokens: 1200, reasoningTokens: 300, completionTokens: 800 }}>
      <div className={`${ARENA_WEB_FRAME_CLASS_NAME} overflow-auto p-6 pt-32 text-gray-900`}>
        <p>可信静态样板，用于检查真实工具栏的自动收起、键盘焦点及沉浸切换；不执行生成内容。</p>
        <label className="input-group"><span className="input-label">沉浸切换保留内容</span><input aria-label="沉浸切换保留内容" className="input-field" defaultValue="进出沉浸后仍保留" /></label>
      </div>
    </ArenaWebViewer> : <StreamingBattleReportCard content="# 普通显示\n\n同一战报的普通卡片样板。" />}
  </section>;
}

function WindowReportSample() {
  const [immersive, setImmersive] = useState(false);
  const [message, setMessage] = useState('作品正在独立隔离窗口中运行。');
  return <section className="min-w-0" aria-label="Web 战报窗口控件与长源码样板">
    <StreamingBattleReportCard content="" mode="classic" disableExport
      aiModel="showroom-example-model" aiUsage={{ promptTokens: 120, completionTokens: 90 }}
      reportContent={<ArenaWebWindowStatusView message={message} />}
      additionalActions={<>
        <ArenaWebReportActions actions={[
          { id: 'download', label: '下载 HTML', icon: <Download />, onClick: () => setMessage('下载操作样板；不导出文件。') },
          { id: 'focus', label: '聚焦作品窗口', icon: <ExternalLink />, onClick: () => setMessage('聚焦操作样板；不创建窗口。') },
          { id: 'reload', label: '重新加载', icon: <RotateCw />, onClick: () => setMessage('重新加载操作样板；不执行网页。') },
          { id: 'status', label: '检查运行状态', icon: <RefreshCw />, onClick: () => setMessage('状态检查样板。') },
          { id: 'close', label: '关闭作品', icon: <X />, disabled: true, onClick: () => {} },
        ]} />
        <ArenaWebImmersiveButton immersive={immersive} onClick={() => setImmersive(value => !value)} />
      </>} />
    <StreamingBattleReportCard content={`# 长源码与长文本\n\n${'long-unbroken-content-'.repeat(30)}\n\n\`\`\`html\n<main data-source="${'long-source-'.repeat(80)}">安全文本</main>\n\`\`\``} />
  </section>;
}

function SemanticColorsSection() {
  return (
    <div className="flex flex-col gap-5">
      {COLOR_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 className="mb-2 text-sm font-medium text-(--app-text-muted)">{group.title}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {group.tokens.map((token) => <TokenSwatch key={token} token={token} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TypographySection() {
  return (
    <div className={`${PANEL_CLASS} flex flex-col gap-4`}>
      <div>
        <h3 className="mb-1 text-sm font-medium text-(--app-text-muted)">--app-font-sans</h3>
        <p className="text-(--app-text)" style={{ fontFamily: 'var(--app-font-sans)' }}>
          魔法少女生成器 — The quick brown fox jumps over the lazy dog 0123456789
        </p>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium text-(--app-text-muted)">--app-font-mono</h3>
        <p className="text-(--app-text)" style={{ fontFamily: 'var(--app-font-mono)' }}>
          {`const codename = '样板间·澄星'; // 0123456789`}
        </p>
      </div>
      <div className="flex flex-col gap-1 border-t border-(--app-border) pt-3">
        {TEXT_TOKENS.map((token) => (
          <p key={token} className="text-(--app-text)" style={{ fontSize: `var(${token})` }}>
            <code className="mr-2 text-xs text-(--app-text-muted)">{token}</code>
            魔法少女生成器 MahoShojo
          </p>
        ))}
      </div>
    </div>
  );
}

function ScalesSection() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className={`${PANEL_CLASS} flex flex-col gap-2`}>
        <h3 className="text-sm font-medium text-(--app-text-muted)">间距（4px 网格）</h3>
        {SPACE_TOKENS.map((token) => (
          <div key={token} className="flex items-center gap-3">
            <code className="w-28 shrink-0 text-xs text-(--app-text-muted)">{token}</code>
            <div className="h-3 rounded-sm" style={{ width: `var(${token})`, background: 'var(--app-accent)' }} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-5">
        <div className={PANEL_CLASS}>
          <h3 className="mb-3 text-sm font-medium text-(--app-text-muted)">圆角</h3>
          <div className="flex flex-wrap items-end gap-4">
            {RADIUS_TOKENS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-1.5">
                <div
                  className="h-14 w-14 border-2"
                  style={{ borderColor: 'var(--app-accent)', borderRadius: `var(${token})`, background: 'var(--app-surface-60)' }}
                />
                <code className="text-xs text-(--app-text-muted)">{token.replace('--app-radius-', '')}</code>
              </div>
            ))}
          </div>
        </div>
        <div className={PANEL_CLASS}>
          <h3 className="mb-3 text-sm font-medium text-(--app-text-muted)">阴影</h3>
          <div className="flex flex-wrap gap-4">
            {SHADOW_TOKENS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-1.5">
                <div
                  className="h-14 w-20 rounded-lg border border-(--app-border) bg-(--app-surface)"
                  style={{ boxShadow: `var(${token})` }}
                />
                <code className="text-xs text-(--app-text-muted)">{token.replace('--app-shadow-', '')}</code>
              </div>
            ))}
          </div>
        </div>
        <div className={PANEL_CLASS}>
          <h3 className="mb-2 text-sm font-medium text-(--app-text-muted)">层级</h3>
          <ul className="flex flex-col gap-1 text-sm text-(--app-text)">
            <li><code>--global-topbar-z-index</code>（既有语义 token）</li>
            {Z_TOKENS.map((token) => <li key={token}><code>{token}</code></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function QuestionnaireNavigationSample() {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className={`${PANEL_CLASS} min-w-0`} aria-label="问卷翻页操作样板">
    <h3 className="text-sm font-semibold">问卷导航：三类问卷、双端共用生产组件</h3>
    <p role="status" className="mt-2 text-sm text-(--app-text-muted)">问题 {index + 1} / 2；第二题必答。样板不会生成或保存内容。</p>
    <label className="input-group mt-3">
      <span className="input-label">第二题答案</span>
      <input aria-label="第二题答案" className="input-field" value={answer} onChange={event => setAnswer(event.target.value)} disabled={busy} />
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input aria-label="模拟操作中" type="checkbox" checked={busy} onChange={event => setBusy(event.target.checked)} />模拟操作中
    </label>
    <QuestionnaireNavigationActions prevLabel="上一题" nextButtonContent={busy ? '提交中...' : index === 0 ? '下一题' : '提交'}
      disablePrev={busy || index === 0} disableNext={busy || (index === 1 && !answer.trim())}
      onPrev={() => setIndex(0)} onNext={() => setIndex(index === 0 ? 1 : 0)} />
    <div className="blue-theme">
      <QuestionnaireNavigationActions prevLabel="返回上题" nextButtonContent="跳过并提交"
        disablePrev disableNext onPrev={() => {}} onNext={() => {}} />
    </div>
  </section>;
}

function ControlsSection() {
  return <div className="flex flex-col gap-4">
    <div className={`${PANEL_CLASS} flex flex-wrap items-center gap-3`}>
      <button type="button" className={generationActionClassNames.primary}>主操作</button>
      <button type="button" className={generationActionClassNames.secondary}>次要操作</button>
      <button type="button" className={generationActionClassNames.destructive}>危险操作</button>
      <button type="button" className={generationActionClassNames.primary} disabled>禁用主操作</button>
      <button type="button" className={generationActionClassNames.secondary} disabled>禁用次要操作</button>
    </div>
    <QuestionnaireNavigationSample />
  </div>;
}

function FormsSection() {
  const [forgeSource, setForgeSource] = useState('{"name":"蔷薇"}');
  const [forgeInstructions, setForgeInstructions] = useState('');
  const [forgeColor, setForgeColor] = useState('#ff6b9d');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  return (
    <div className={`${PANEL_CLASS} flex flex-col gap-5`}>
      <div className="max-w-md">
        <div className="input-group">
          <label id="showroom-input-label" className="input-label" htmlFor="showroom-input">输入标签（.input-label）</label>
          <input id="showroom-input" aria-labelledby="showroom-input-label" className="input-field" type="text" placeholder="占位文本走 --app-text-subtle" />
        </div>
        <div className="input-group mb-0">
          <label id="showroom-input-filled-label" className="input-label" htmlFor="showroom-input-filled">已填写输入</label>
          <input id="showroom-input-filled" aria-labelledby="showroom-input-filled-label" className="input-field" type="text" defaultValue="示例输入内容" readOnly />
        </div>
      </div>
      <div role="group" aria-label="卡牌工坊主题色样板">
        <CardForgeSourceFields sourceCardJson={forgeSource} customInstructions={forgeInstructions} onSourceCardJsonChange={setForgeSource} onCustomInstructionsChange={setForgeInstructions} />
        <CardForgeThemeEditor color={forgeColor} onChange={setForgeColor} />
      </div>
      <div className="grid gap-4 md:grid-cols-2" aria-label="生成方式说明样板">
        <GenerationModeSwitcher label="默认生成说明" value={generationMode} onChange={setGenerationMode} />
        <GenerationModeSwitcher label="宿主生成说明" value={generationMode} onChange={setGenerationMode}
          helper="连接中断时只找回同一次生成的内容；停止任务需要服务器确认。" />
      </div>
      <div className="flex flex-col gap-2 border-t border-(--app-border) pt-4">
        <h3 className="text-sm font-medium text-(--app-text-muted)">battle-lite 共享类</h3>
        <p className="battle-lite-strong-text">.battle-lite-strong-text —— 主文本</p>
        <p className="battle-lite-muted-text">.battle-lite-muted-text —— 弱化文本</p>
        <p className="battle-lite-subtle-text">.battle-lite-subtle-text —— 最弱文本</p>
        <p><a href="#showroom-forms" className="battle-lite-link">.battle-lite-link —— 链接样式</a></p>
        <div className="battle-lite-accent-box rounded-lg p-3 text-sm">.battle-lite-accent-box —— 强调盒面</div>
        <div className="battle-lite-info-box rounded-lg p-3 text-sm">.battle-lite-info-box —— 信息盒面</div>
        <span className="battle-lite-info-pill inline-block rounded-full px-3 py-1 text-xs">.battle-lite-info-pill</span>
      </div>
    </div>
  );
}

function OverlaySection({ onOpen }: { onOpen: () => void }) {
  return (
    <div className={`${PANEL_CLASS} flex flex-wrap items-center gap-3`}>
      <button type="button" className={generationActionClassNames.secondary} onClick={onOpen}>
        打开示例对话框
      </button>
      <p className="text-sm text-(--app-text-muted)">共源 BaseModal：Escape 栈顶消费、焦点圈留、初始焦点在关闭按钮。</p>
    </div>
  );
}

function StoryReadErrorsSample() {
  const [branchOpen, setBranchOpen] = useState(false);
  const [chapterError, setChapterError] = useState(true);
  return (
    <div className={`${PANEL_CLASS} flex flex-col gap-3`} aria-label="故事读取错误样板">
      <h3 className="text-sm font-medium text-(--app-text-muted)">连续故事：明确读取错误与原有操作</h3>
      <BattleStorySessionDirectory rows={[]} selectedId={null} onSelect={() => {}}
        error={'示例：故事目录读取失败\n已保存的故事不受影响。'} />
      <BattleStoryChapterReader state={chapterError
        ? { status: 'error', identity: { sessionId: 'showroom', chapterId: 'chapter' }, message: '示例：章节读取失败\n可以显式重读。' }
        : { status: 'loaded', identity: { sessionId: 'showroom', chapterId: 'chapter' }, title: '示例章节', content: <p>已读取示例正文，未发出网络请求。</p> }}
        errorActions={<button type="button" className={generationActionClassNames.secondary} onClick={() => setChapterError(false)}>模拟重读本章</button>} />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={generationActionClassNames.secondary} onClick={() => setChapterError(true)}>重置章节错误样板</button>
        <button type="button" className={generationActionClassNames.secondary} onClick={() => setBranchOpen(true)}>打开分支读取错误样板</button>
      </div>
      <BattleStoryBranchChainModal isOpen={branchOpen} onClose={() => setBranchOpen(false)} onSelectSession={() => {}}
        sessions={[]} activeSession={null} error={'示例：分支来源读取失败\n原故事仍保留。'} />
    </div>
  );
}

function ResultSurfacesSection() {
  const [copyResult, setCopyResult] = useState<boolean | null>(null);
  const [width, setWidth] = useState<BattleReportCardWidthSettingsValue>({ battleReportCardWidthMode: 'manual', battleReportCardWidthPx: 760 });
  return (
    <div className="flex flex-col gap-3">
      <div className={PANEL_CLASS} aria-label="情景 Markdown 预览样板">
        <ScenarioResultContent data={{
          description: '## 场景概览\n\n**钟楼**中的一次调查。\n\n- 寻找线索\n- 观察星空',
          elements: { events: '# 简报\\n\\n---\\n\\n## 任务\\n记录星轨。' },
          extension: { preserved: true },
        }} />
      </div>
      <div aria-label="竞技场结果布局样板">
        <AdvancedArenaPageView header={<h3>完整版竞技场</h3>} result={<section className="card"><h4>结果状态</h4><p>结果卡随页面展开，使用共源 Arena 布局。</p></section>}>
          <p className="text-sm text-(--app-text-muted)">共享页框的实际结果插槽</p>
        </AdvancedArenaPageView>
        <BattleLitePageView isGenerating={false} presetCountLabel="0" combatantCountLabel="0" showScenario={false} hasScenario={false}
          materialCount={0} referenceItemCount={0} maxReferenceItems={256} slots={{
            header: <h3>简版竞技场</h3>, rankingLinks: null, pageLinks: null, presets: null, database: null,
            localImport: null, roster: null, mode: null, scenario: null, materials: null, storyOptions: null,
            generationMode: null, actions: null, community: null, storySession: null, homeLink: null, footer: null,
            result: <section className="card"><h4>结果状态</h4><p>简版结果卡同样使用完整可用宽度。</p></section>,
          }} />
      </div>
      <p className="text-sm text-(--app-text-muted)">
        以下为共享 <code>MagicalGirlCard</code> 真实组件（fixture 数据 + <code>MAGICAL_GIRL_CARD_GRADIENT</code>）：
      </p>
      <div className="max-w-3xl">
        <MagicalGirlCard magicalGirl={SHOWROOM_MAGICAL_GIRL} gradientStyle={MAGICAL_GIRL_CARD_GRADIENT}
          generatedByBadge={<GeneratedByUserBadgeView username="样板导出账号" label={CHARACTER_CARD_EXPORTER_LABEL} className="mt-3" />} />
      </div>
      <div className="max-w-3xl">
        <h3 className="mb-3 text-sm font-medium text-(--app-text-muted)">竞技场安全源码：共享品牌与元数据（示例用量）</h3>
        <div aria-label="战报卡片宽度样板">
          <BattleReportCardWidthSettings value={width} onChange={patch => setWidth(current => ({ ...current, ...patch }))} />
          <BattleReportCardWidthSettings value={width} onChange={() => {}} disabled />
        </div>
        <StreamingBattleReportCard cardWidthPx={resolveBattleReportCardManualWidthPx(width)} content="<main>样板间战报</main>" mode="classic" disableExport
          aiModel="showroom-example-model" aiUsage={{ promptTokens: 120, reasoningTokens: 30, completionTokens: 90 }}
          reporterInfo={{ name: '样板记者', publication: '样板日报' }}
          reportContent={<ArenaWebResultView source="<main>样板间战报</main>" ready
            execution={{ available: false, reason: '样板间只展示安全文本，不运行生成代码。' }} />} />
      </div>
      <CombatantUpdatesPresentation keepMounted itemDefaultOpen={false} title="角色更新：首次展开后保留操作状态"
        items={[{ key: 'showroom-role-update', displayName: '样板角色', impact: '本次历战影响' }]}
        renderMarkdown={content => <p>{content}</p>}
        renderActions={() => <label className="input-group"><span className="input-label">折叠前后保留的草稿</span><input aria-label="折叠前后保留的草稿" className="input-field" defaultValue="可修改后折叠验证" /></label>} />
      <div className={PANEL_CLASS} aria-label="完整结果 JSON 复制样板">
        <h3 className="text-sm font-medium text-(--app-text-muted)">复制完整结果 JSON</h3>
        <ResultJsonCopyButton data={SHOWROOM_MAGICAL_GIRL} className={generationActionClassNames.secondary} onResult={setCopyResult} />
        {copyResult !== null && <p role="status">{copyResult ? '完整结果 JSON 已复制到剪贴板' : '复制失败，请检查剪贴板权限。'}</p>}
      </div>
      <WebViewerSample />
      <WindowReportSample />
      <StoryReadErrorsSample />
      <ImageGenerationSample />
      <LocalImagesSample />
      <div className="grid min-w-0 gap-3 md:grid-cols-2" aria-label="竞技场操作反馈样板">
        {(['full', 'lite'] as const).map(appearance => <div key={appearance} className={appearance === 'lite' ? 'battle-lite-shell min-w-0' : 'min-w-0'}>
          <h3 className="text-sm font-medium text-(--app-text-muted)">{appearance === 'lite' ? '简化版' : '完整版'}操作反馈</h3>
          {['❌ 数据卡 JSON 解析失败\n原输入仍保留。', '✨ 魔法失效了！网络连接中断\n示例内容，不触发真实请求。'].map(message =>
            <ArenaFeedbackView key={message} message={message} tone={resolveArenaFeedbackTone(message)} appearance={appearance}>
              <div className="mt-2 text-xs opacity-95">
                <a href="#showroom-result-surfaces" className="underline underline-offset-2 hover:opacity-100">查看百科：示例帮助</a>
              </div>
            </ArenaFeedbackView>)}
        </div>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2" aria-label="错误文字对比样板">
        {['默认红色', '蓝色主题'].map((label, index) => <div key={label} className={index ? 'blue-theme' : undefined}>
          <ErrorMessageBox message={`${label}：普通正文保持清晰，原文换行仍保留。\n示例错误内容，不触发真实请求。`}>
            <div className="mt-2 text-xs opacity-95">
              <a href="#showroom-result-surfaces" className="underline underline-offset-2 hover:opacity-100">95% 帮助链接：悬停与焦点仍继承错误文字颜色</a>
            </div>
          </ErrorMessageBox>
        </div>)}
      </div>
    </div>
  );
}

function ImageGenerationSample() {
  const [busy, setBusy] = useState(true);
  return (
    <div className={PANEL_CLASS} aria-label="图片生成任务与结果样板">
      <h3 className="text-sm font-medium text-(--app-text-muted)">图片生成：等待、结果未知与原任务查询</h3>
      <ImageGenerationFeedback busy={busy} progress={35} statusText="示例：供应商正在生成图片"
        outcome={busy ? undefined : 'stopped'} taskId={busy ? undefined : 'showroom-existing-image-task'}
        onStop={() => setBusy(false)} onResume={() => setBusy(true)} />
      <ImageGenerationFeedback busy progress={null} statusText="示例：等待同步图片响应" />
      <ImageGenerationFeedback busy={false} progress={null} outcome="unresolved" error="示例：创建响应未能确认。" />
      <div className="max-w-xs">
        <ImageGenerationResultView imageUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
          seed={0} download={{ filename: 'showroom-image.png' }} />
      </div>
    </div>
  );
}

export function ShowroomView({ assetSource = { baseUrl: '/' } }: ShowroomViewProps) {
  const { preference, resolvedMode, setPreference, isHydrated } = useColorModePreference();
  const [modalOpen, setModalOpen] = useState(false);

  const sectionContent = (id: ShowroomSectionId): ReactNode => {
    switch (id) {
      case 'semantic-colors': return <SemanticColorsSection />;
      case 'typography': return <TypographySection />;
      case 'scales': return <ScalesSection />;
      case 'controls': return <ControlsSection />;
      case 'forms': return <FormsSection />;
      case 'overlay': return <OverlaySection onOpen={() => setModalOpen(true)} />;
      case 'result-surfaces': return <ResultSurfacesSection />;
      case 'footer': return <ProductFooter assetSource={assetSource} />;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10" data-showroom-root>
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold text-(--app-text)">视觉样板间</h1>
        <p className="max-w-3xl text-sm text-(--app-text-muted)">
          双端共源视觉基线的集中审查面（SPEC-visual-baseline-v1 VIS-SHOW-001）：
          全部样板直接渲染生产 token 与生产组件，不做"好看版"另写。
          开发路由专用，不进产品导航。
        </p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="颜色模式（与设置页同一共享偏好）">
          <span className="text-sm text-(--app-text-muted)">
            颜色模式{isHydrated ? `（当前解析：${resolvedMode === 'dark' ? '暗' : '亮'}）` : ''}：
          </span>
          {COLOR_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={preference === option.value}
              onClick={() => setPreference(option.value)}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                preference === option.value
                  ? 'border-(--app-accent) bg-(--app-surface) font-medium text-(--app-text)'
                  : 'border-(--app-border) bg-(--app-surface-60) text-(--app-text-muted) hover:bg-(--app-surface)'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <nav aria-label="样板间分区导航" className="flex flex-wrap gap-2 text-sm">
          {SHOWROOM_SECTIONS.map((section) => (
            <a key={section.id} href={`#showroom-${section.id}`} className="battle-lite-link">
              {section.title}
            </a>
          ))}
        </nav>
      </header>

      {SHOWROOM_SECTIONS.map((section) => (
        <SectionFrame key={section.id} id={section.id} title={section.title} summary={section.summary}>
          {sectionContent(section.id)}
        </SectionFrame>
      ))}

      <BaseModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="示例对话框"
        description="共享 BaseModal 原语演示"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className={generationActionClassNames.secondary} onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="button" className={generationActionClassNames.primary} onClick={() => setModalOpen(false)}>
              确认
            </button>
          </div>
        )}
      >
        <p className="text-sm">
          Tab 在对话框内循环；Escape 关闭栈顶一层；背景点按同样关闭。
          这些行为与生产弹层共享同一 escape-stack 登记。
        </p>
      </BaseModal>
    </div>
  );
}
