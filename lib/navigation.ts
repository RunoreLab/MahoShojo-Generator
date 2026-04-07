export type NavGroupId = 'creative' | 'battle' | 'character' | 'knowledge';

export interface NavItem {
  label: string;
  href: string;
  description?: string;
  isTopbarCovered: boolean;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  items: NavItem[];
}

export const TOPBAR_COVERED_ROUTES = [
  '/',
  '/battle',
  '/arena',
  '/creator',
  '/character-manager',
  '/me',
  '/pvp',
] as const;

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'creative',
    label: '创作',
    items: [
      {
        label: '创作工作台',
        href: '/creator',
        description: '问卷、规则与生成流程集中工作台',
        isTopbarCovered: true,
      },
      {
        label: '魔法少女生成',
        href: '/name',
        description: '经典魔法少女生成入口',
        isTopbarCovered: false,
      },
      {
        label: '自由生成',
        href: '/free',
        description: '更自由的角色生成流程',
        isTopbarCovered: false,
      },
      {
        label: '情景生成',
        href: '/scenario',
        description: '生成或整理情景卡',
        isTopbarCovered: false,
      },
    ],
  },
  {
    id: 'battle',
    label: '竞技',
    items: [
      {
        label: '简洁竞技场',
        href: '/battle',
        description: '低压迫感的快速战报流程',
        isTopbarCovered: true,
      },
      {
        label: '完整竞技场',
        href: '/arena',
        description: '完整竞技场控制台',
        isTopbarCovered: true,
      },
      {
        label: 'PVP',
        href: '/pvp',
        description: '卡牌对决大厅',
        isTopbarCovered: true,
      },
      {
        label: '排行榜',
        href: '/ranking',
        description: '排位榜单与赛季信息',
        isTopbarCovered: false,
      },
    ],
  },
  {
    id: 'character',
    label: '角色',
    items: [
      {
        label: '角色管理',
        href: '/character-manager',
        description: '登录、云端保存与角色库管理',
        isTopbarCovered: true,
      },
      {
        label: '个人页',
        href: '/me',
        description: '战报记录、PVP 记录与个人设置',
        isTopbarCovered: true,
      },
      {
        label: '角色成长',
        href: '/sublimation',
        description: '角色成长与升华流程',
        isTopbarCovered: false,
      },
    ],
  },
  {
    id: 'knowledge',
    label: '百科',
    items: [
      {
        label: '百科目录',
        href: '/encyclopedia',
        description: '使用说明、规则与进阶资料',
        isTopbarCovered: false,
      },
    ],
  },
];

const TOPBAR_COVERED_ROUTE_SET = new Set<string>(TOPBAR_COVERED_ROUTES);

const normalizePathname = (pathname: string): string => {
  const [withoutHash] = pathname.split('#');
  const [withoutQuery] = withoutHash.split('?');

  if (!withoutQuery) {
    return '/';
  }

  if (withoutQuery !== '/' && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }

  return withoutQuery;
};

export const isTopbarCoveredPath = (pathname: string): boolean => {
  return TOPBAR_COVERED_ROUTE_SET.has(normalizePathname(pathname));
};

export const getNavGroupForPath = (pathname: string): NavGroup | null => {
  const normalized = normalizePathname(pathname);

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (normalized === item.href || normalized.startsWith(`${item.href}/`)) {
        return group;
      }
    }
  }

  return null;
};

export const getTopbarCoverage = (
  pathname: string,
): { isCovered: boolean; activeGroupId: NavGroupId | null } => {
  if (!isTopbarCoveredPath(pathname)) {
    return { isCovered: false, activeGroupId: null };
  }

  return {
    isCovered: true,
    activeGroupId: getNavGroupForPath(pathname)?.id ?? null,
  };
};
