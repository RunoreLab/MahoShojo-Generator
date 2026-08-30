import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/creation/NamePage', () => ({
  NamePage: function NamePageMock() {
    return <main data-page="name">名称生成</main>;
  },
}));

vi.mock('@/components/creation/DetailsPage', () => ({
  DetailsPage: function DetailsPageMock() {
    return <main data-page="details">魔法少女调查</main>;
  },
}));

vi.mock('@/components/creation/CanshouPage', () => ({
  CanshouPage: function CanshouPageMock() {
    return <main data-page="canshou">残兽生成</main>;
  },
}));

vi.mock('@/components/creation/FreePage', () => ({
  FreePage: function FreePageMock() {
    return <main data-page="free">自由生成</main>;
  },
}));

vi.mock('@/components/creation/ScenarioPage', () => ({
  ScenarioPage: function ScenarioPageMock() {
    return <main data-page="scenario">箱庭物语</main>;
  },
}));

vi.mock('@/components/creation/CreatorPage', () => ({
  CreatorPage: function CreatorPageMock() {
    return <main data-page="creator">创作工房</main>;
  },
}));

vi.mock('@/components/creation/QuestionnaireEditorPage', () => ({
  QuestionnaireEditorPage: function QuestionnaireEditorPageMock() {
    return <main data-page="questionnaire-editor">问卷编辑器</main>;
  },
}));

describe('creative App Router pages', () => {
  test('name route renders migrated client page and default metadata', async () => {
    const { default: NameRoute, metadata } = await import('@/app/name/page');
    const html = renderToStaticMarkup(<NameRoute />);

    expect(metadata).toMatchObject({
      title: '✨ 魔法少女生成器 ✨',
      description: 'AI驱动的魔法少女角色生成器，创建独一无二的魔法少女角色',
    });
    expect(html).toContain('data-page="name"');
  });

  test('details route renders migrated client page and migrated metadata', async () => {
    const { default: DetailsRoute, metadata } = await import('@/app/details/page');
    const html = renderToStaticMarkup(<DetailsRoute />);

    expect(metadata).toMatchObject({
      title: '魔法少女调查问卷 ~ 奇妙妖精大调查',
      description: '回答问卷，生成您的专属魔法少女',
    });
    expect(html).toContain('data-page="details"');
  });

  test('canshou route renders migrated client page and migrated metadata', async () => {
    const { default: CanshouRoute, metadata } = await import('@/app/canshou/page');
    const html = renderToStaticMarkup(<CanshouRoute />);

    expect(metadata).toMatchObject({
      title: '残兽生成器 - 间界残兽前进基地',
    });
    expect(html).toContain('data-page="canshou"');
  });

  test('free route renders migrated client page and migrated metadata', async () => {
    const { default: FreeRoute, metadata } = await import('@/app/free/page');
    const html = renderToStaticMarkup(<FreeRoute />);

    expect(metadata).toMatchObject({
      title: '自由生成 - MahoShojo Generator',
      description: '自由输入提示词，按指定 Schema 生成任意数据卡（角色/情景）。自由生成产物为非原生。',
    });
    expect(html).toContain('data-page="free"');
  });

  test('scenario route renders migrated client page and migrated metadata', async () => {
    const { default: ScenarioRoute, metadata } = await import('@/app/scenario/page');
    const html = renderToStaticMarkup(<ScenarioRoute />);

    expect(metadata).toMatchObject({
      title: '箱庭物语 - MahoShojo Generator',
      description: '通过回答问题，快速生成用于竞技场的自定义故事场景。',
    });
    expect(html).toContain('data-page="scenario"');
  });

  test('creator route renders migrated client page and migrated metadata', async () => {
    const { default: CreatorRoute, metadata } = await import('@/app/creator/page');
    const html = renderToStaticMarkup(<CreatorRoute />);

    expect(metadata).toMatchObject({
      title: '创作工房',
      description: '组合问卷、规则与补充说明，生成角色卡、情景卡等内容。',
    });
    expect(html).toContain('data-page="creator"');
  });

  test('questionnaire editor route renders migrated client page and migrated metadata', async () => {
    const { default: QuestionnaireEditorRoute, metadata } = await import('@/app/questionnaire-editor/page');
    const html = renderToStaticMarkup(<QuestionnaireEditorRoute />);

    expect(metadata).toMatchObject({
      title: '问卷编辑器',
    });
    expect(html).toContain('data-page="questionnaire-editor"');
  });
});
