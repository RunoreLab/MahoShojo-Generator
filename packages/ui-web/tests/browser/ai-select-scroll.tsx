import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AiProviderCustomSelect } from '../../src/ai-provider/custom-select';

/** 只模拟流式内容增长与宿主重渲染，菜单使用生产组件，不请求模型或账户。 */
function ScrollFixture() {
  const nested = new URLSearchParams(location.search).has('nested');
  const [revision, setRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [value, setValue] = useState('model-12');
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setRevision(current => current + 1), 80);
    return () => window.clearInterval(timer);
  }, [running]);

  const select = <AiProviderCustomSelect
    // 故意每帧传入新数组，覆盖宿主目录/状态重新映射的实际调用形态。
    options={Array.from({ length: 30 }, (_, index) => ({
      value: `model-${index}`,
      label: `模型 ${index}`,
      description: '共享模型选择器滚动回归',
      group: index < 15 ? '内置模型' : '其他模型',
    }))}
    value={value}
    onChange={setValue}
    placeholder="选择模型"
  />;

  return <main className="mx-auto max-w-2xl p-4">
    <h1 className="text-xl font-semibold">模型选择器滚动回归夹具</h1>
    <button className="btn-secondary" data-testid="stream" onClick={() => setRunning(current => !current)}>
      {running ? '暂停模拟生成' : '开始模拟生成'}
    </button>
    <output data-testid="revision">{revision}</output>
    <div className="h-96" /><div className="h-96" /><div className="h-96" />
    {nested ? <div data-testid="ancestor" className="h-96 overflow-y-auto border border-(--app-border) p-4">
      <div className="h-32" />
      {select}
      <div className="h-96" /><div className="h-96" />
    </div> : select}
    <section aria-label="模拟流式战报" className="space-y-4 py-8">
      {Array.from({ length: 30 + revision }, (_, index) => <p key={index}>战报段落 {index}：内容持续增长时，读者应仍能自主滚动。</p>)}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ScrollFixture />);
