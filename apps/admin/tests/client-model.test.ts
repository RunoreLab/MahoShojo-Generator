import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Values } from '../src/client/observations';
import { batchItemAction, cleanQuery, fieldValue, isVersion, operationFingerprint, outcomeState, parseFields, savedOperations, saveOperation, type Action, type ActionField } from '../src/client/ui-model';

const field = (name: string, type = 'text', required = true): ActionField => ({ name, label: name, type, required });
const action = (name: string, fields: ActionField[] = []): Action => ({ name, label: name, resource: 'data-cards', fields });
afterEach(() => vi.unstubAllGlobals());
describe('管理工作台表单与操作恢复', () => {
  it('AI 审核表单与幂等指纹保留 provider 和 model 两个维度', async () => {
    const form = new FormData(); form.set('provider', 'provider-b'); form.set('model', 'shared-model'); form.set('reason', '辅助审核');
    const payload = parseFields(action('ai.review', [field('provider'), field('model')]), form);
    expect(payload).toEqual({ provider: 'provider-b', model: 'shared-model', reason: '辅助审核' });
    expect(await operationFingerprint('ai.review', payload)).not.toBe(await operationFingerprint('ai.review', { ...payload, provider: 'provider-a' }));
  });

  it('仅启用批量动作时使用自身字段目录，兼容旧目录原动作回退', () => {
    const original = action('cards.review', [field('id'), field('expectedVersion'), field('decision')]);
    const batch = { ...action('cards.review.batch', [field('items', 'json')]), itemFields: original.fields };
    expect(batchItemAction(batch, [batch])).toMatchObject({ name: 'cards.review', fields: original.fields });
    expect(batchItemAction({ ...batch, itemFields: undefined }, [original])).toEqual(original);
    expect(batchItemAction({ ...batch, itemFields: undefined }, [])).toBeUndefined();
  });
  it('作业取消从只读记录自动获取时间版本，作为隐藏CAS字段', () => {
    const selected = { id: 'job', updated_at: '2026-09-12T01:02:03.000Z' };
    expect(isVersion('expectedUpdatedAt')).toBe(true);
    expect(fieldValue(action('jobs.cancel'), field('expectedUpdatedAt'), selected)).toBe(selected.updated_at);
    const form = new FormData(); form.set('id', 'job'); form.set('expectedUpdatedAt', selected.updated_at); form.set('reason', '已核实请求结果');
    expect(parseFields(action('jobs.cancel', [field('id'), field('expectedUpdatedAt')]), form)).toEqual({ id: 'job', expectedUpdatedAt: selected.updated_at, reason: '已核实请求结果' });
  });
  it('映射布尔、蛇形字段及默认卡槽，创建不会复制所选记录', () => {
    const row = { id: 'card', is_public: 0, is_banned: 'reason', is_review_exempt: 0, slot_count: null, is_recommended: 0, text_color: '{"type":"solid","value":"#fff"}' };
    expect(fieldValue(action('cards.visibility'), field('visibility', 'number'), row)).toBe(0);
    expect(fieldValue(action('users.ban'), field('banned', 'boolean'), row)).toBe(true);
    expect(fieldValue(action('users.review-exempt'), field('exempt', 'boolean'), row)).toBe(false);
    expect(fieldValue(action('users.slots'), field('slotCount', 'number'), row)).toBe(0);
    expect(fieldValue(action('cards.recommend'), field('recommended', 'boolean'), row)).toBe(false);
    expect(fieldValue(action('badges.update'), field('textColor', 'json'), row)).toEqual({ type: 'solid', value: '#fff' });
    expect(fieldValue(action('badges.create'), field('id'), row)).toBeUndefined();
  });
  it('清除头衔和描述时显式提交空字符串，保留 false 与零', () => {
    const form = new FormData(); form.set('prefix', ''); form.set('description', ''); form.set('slotCount', '0'); form.set('banned', 'false'); form.set('reason', ' reset ');
    expect(parseFields(action('edit', [field('prefix'), field('description'), field('slotCount', 'number'), field('banned', 'boolean')]), form)).toEqual({ prefix: '', description: '', slotCount: 0, banned: false, reason: 'reset' });
  });
  it('坏 JSON 与缺少必填版本阻止提交', () => {
    const form = new FormData(); form.set('items', '{bad'); form.set('reason', 'test');
    expect(() => parseFields(action('test', [field('items', 'json')]), form)).toThrow('JSON');
    expect(() => parseFields(action('test', [field('expectedVersion')]), form)).toThrow('expectedVersion');
  });
  it('URL过滤保留零及分页，移除空筛选与UI参数', () => {
    expect(cleanQuery(new URLSearchParams('q=++&id=&visibility=0&status=approved&cursor=next&action=x'), ['q', 'id', 'visibility', 'status', 'cursor']).toString()).toBe('visibility=0&status=approved&cursor=next');
  });
  it('预览默认只读并自动选择当前卡片审核目标版本', () => {
    expect(fieldValue(action('analytics.snapshot'), field('dryRun', 'boolean'), null)).toBe(true);
    expect(fieldValue(action('ai.review'), field('targets', 'json'), { id: 'card', expectedVersion: 'version' })).toEqual([{ kind: 'card', id: 'card', expectedVersion: 'version' }]);
    expect(fieldValue({ ...action('ai.review'), resource: 'data-card-updates' }, field('targets', 'json'), { id: 'update', expectedVersion: 'version' })).toEqual([{ kind: 'update', id: 'update', expectedVersion: 'version' }]);
  });
  it('刷新后恢复查询键且按管理员隔离，不存正文和理由', async () => {
    const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    const payload = { reason: 'private reason', bodyText: 'private body' };
    const fingerprint = await operationFingerprint('test', payload);
    saveOperation('principal-a', { key: 'key', fingerprint, action: 'test', label: '测试', createdAt: new Date().toISOString(), state: 'unknown' });
    expect(savedOperations('principal-a')[0].key).toBe('key'); expect(savedOperations('principal-b')).toEqual([]);
    expect([...values.values()].join('')).not.toContain('private'); expect(fingerprint).toHaveLength(64);
    expect(await operationFingerprint('test', { ...payload, bodyText: 'changed' })).not.toBe(fingerprint);
  });
  it('损坏本地存储不会导致页面失败，写入失败不得静默忽略', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{bad', setItem: () => { throw new Error('storage denied'); } });
    expect(savedOperations('principal')).toEqual([]);
    expect(() => saveOperation('principal', { key: 'key', fingerprint: 'hash', action: 'test', label: 'test', createdAt: 'now', state: 'unknown' })).toThrow('storage denied');
  });
  it('分批或部分失败不能误报全部成功', () => {
    expect(outcomeState({ status: 'partial', operations: [{ status: 'succeeded' }] })).toBe('partial');
    expect(outcomeState({ status: 'batch', items: [{ status: 'succeeded' }, { status: 'failed' }] })).toBe('partial');
    expect(outcomeState({ status: 'batch', operations: [{ status: 'succeeded' }] })).toBe('succeeded');
    expect(outcomeState({ status: 'batch', operations: [] })).toBe('partial');
    expect(outcomeState({ results: [{ status: 'succeeded' }, { status: 'conflict' }] })).toBe('partial');
    expect(outcomeState({ status: 'uncertain' })).toBe('uncertain'); expect(outcomeState({ dryRun: true })).toBe('preview');
  });
  it('用户HTML与危险URL只能成为转义文本，不成为标签或链接', () => {
    const html = renderToStaticMarkup(createElement(Values, { value: { title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', svg: '<svg onload=alert(1)>' } }));
    expect(html).not.toContain('<img'); expect(html).not.toContain('<svg'); expect(html).not.toContain('href='); expect(html).toContain('&lt;img');
  });
});
