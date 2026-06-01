import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DataCard from '@/components/DataCard';
import type { BadgeDefinition } from '@/types/badge';

const makeBadge = (id: string, name: string): BadgeDefinition => ({
  id,
  name,
  description: name,
  icon: { type: 'emoji', value: '🏷️' },
  textColor: { type: 'solid', value: '#ffffff' },
  backgroundColor: { type: 'solid', value: '#7c3aed' },
  borderColor: { type: 'solid', value: '#a78bfa' },
  rarity: 50,
  sortOrder: 1,
  isActive: true,
});

describe('DataCard author badges layout', () => {
  it('keeps author badges inside the card footer when the author row is crowded', () => {
    const html = renderToStaticMarkup(
      <DataCard
        id="card-1"
        name="I_moly[Code_Version]"
        description="神秘归档女V3.8.2堂堂复出，未经过允许禁止模仿抄袭复用上传。"
        type="character"
        roleType="general"
        isPublic={1}
        author="I_moly[Code_Version]"
        authorBadges={[
          makeBadge('veteran', '老资历'),
          makeBadge('domain', '领域展开'),
        ]}
        usageCount={38}
        likeCount={6}
        favoriteCount={6}
      />,
    );

    expect(html).toContain('data-card-author-row');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('data-card-author-badges');
    expect(html).toContain('max-w-full');
    expect(html).not.toContain('data-card-author-badges shrink-0');
  });
});
