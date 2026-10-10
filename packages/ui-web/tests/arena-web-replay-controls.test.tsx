// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaWebReplayControlsView, type ArenaWebReplayControlsViewProps } from '../src/arena-report';

const first = { id: 'test.replay', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` };
const second = { id: 'test.replay', version: '2.0.0', digest: `sha256:${'b'.repeat(64)}` };
let root: Root;
let container: HTMLDivElement;
const defaults = (): ArenaWebReplayControlsViewProps => ({
  status: 'mismatch-available', candidates: [first, second], selectedCandidateDigest: null,
  onSelectCandidate: vi.fn(), onConfirmCompatibility: vi.fn(), onImportFile: vi.fn(async () => {}),
});
const render = async (props: ArenaWebReplayControlsViewProps, key = 'one') => { await act(async () => root.render(<ArenaWebReplayControlsView key={key} {...props} />)); };
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!;
const upload = (file?: File) => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('controlled replay repair controls', () => {
  it('requires an explicitly selected valid candidate and explicit confirmation, without resolving or executing', async () => {
    const props = defaults();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render(props);
    expect(button('仍尝试').disabled).toBe(true);
    const select = container.querySelector('select')!;
    expect(select.textContent).toContain(`${second.version} · ${second.digest}`);
    await act(async () => { select.value = second.digest; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(props.onSelectCandidate).toHaveBeenCalledWith(second.digest);
    expect(props.onConfirmCompatibility).not.toHaveBeenCalled();
    await render({ ...props, selectedCandidateDigest: second.digest });
    await act(async () => button('仍尝试').click());
    expect(props.onConfirmCompatibility).toHaveBeenCalledExactlyOnceWith(second);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('iframe,script,img,a')).toBeNull();
    await render({ ...props, selectedCandidateDigest: `sha256:${'c'.repeat(64)}` });
    expect(button('仍尝试').disabled).toBe(true);
  });

  it('keeps single-candidate selection host-owned and exposes its exact identity', async () => {
    const props = { ...defaults(), candidates: [first] };
    await render(props);
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).toContain(`${first.id}@${first.version} · ${first.digest}`);
    expect(button('仍尝试').disabled).toBe(true);
    await render({ ...props, selectedCandidateDigest: first.digest });
    expect(button('仍尝试').disabled).toBe(false);
    expect(props.onConfirmCompatibility).not.toHaveBeenCalled();
  });

  it('only exposes repair for missing, mismatch or rejected states and honors host disable/copy', async () => {
    const props = defaults();
    for (const status of ['exact', 'compatibility', null] as const) {
      await render({ ...props, status, message: '<script>只是状态</script>' });
      expect(container.querySelector('button,input,select')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
    }
    await render({ ...props, status: 'missing-package' });
    expect(container.querySelector('select')).toBeNull();
    expect(button('仍尝试')).toBeUndefined();
    expect(button('重新导入')).toBeTruthy();
    await render({ ...props, selectedCandidateDigest: second.digest, disabled: true, copy: { confirmCompatibilityLabel: '确认进行安全校验' } });
    expect(button('确认进行安全校验').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    await act(async () => upload(new File(['bytes'], 'base.zip')));
    expect(props.onImportFile).not.toHaveBeenCalled();
  });

  it('preserves successful normalization diagnostics after exact replay no longer needs repair', async () => {
    await render({ ...defaults(), status: 'exact', importFeedback: {
      message: '', hint: '', diagnostics: ['已补全缺省媒体类型', '兼容入口已规范化为 index.html'],
    } });
    expect(container.textContent).toContain('已补全缺省媒体类型');
    expect(container.textContent).toContain('兼容入口已规范化为 index.html');
    expect(container.querySelector('button,input,select')).toBeNull();
  });

  it('locks repeated imports synchronously and preserves the selected candidate on file cancel or host cancellation', async () => {
    let settle!: (value: 'cancelled') => void;
    const props = { ...defaults(), selectedCandidateDigest: second.digest,
      onImportFile: vi.fn(() => new Promise<'cancelled'>((resolve) => { settle = resolve; })) };
    await render(props);
    await act(async () => upload());
    expect(props.onImportFile).not.toHaveBeenCalled();
    await act(async () => { upload(new File(['bytes'], 'base.zip')); upload(new File(['again'], 'again.zip')); });
    expect(props.onImportFile).toHaveBeenCalledOnce();
    expect(button('正在导入').disabled).toBe(true);
    await act(async () => settle('cancelled'));
    expect(container.querySelector('select')?.value).toBe(second.digest);
    expect(button('重新导入').disabled).toBe(false);
    expect(props.onSelectCandidate).not.toHaveBeenCalled();
    expect(props.onConfirmCompatibility).not.toHaveBeenCalled();
  });

  it('does not let a stale finally release a new result import or replace its selected candidate', async () => {
    const resolves: (() => void)[] = [];
    const props = { ...defaults(), selectedCandidateDigest: first.digest,
      onImportFile: vi.fn(() => new Promise<void>((resolve) => { resolves.push(resolve); })) };
    await render(props, 'old');
    await act(async () => upload(new File(['old'], 'old.zip')));
    await render({ ...props, selectedCandidateDigest: second.digest }, 'new');
    await act(async () => upload(new File(['new'], 'new.zip')));
    await act(async () => resolves[0]());
    expect(button('正在导入').disabled).toBe(true);
    expect(container.querySelector('select')?.value).toBe(second.digest);
    await act(async () => resolves[1]());
    expect(button('重新导入').disabled).toBe(false);
  });
});
