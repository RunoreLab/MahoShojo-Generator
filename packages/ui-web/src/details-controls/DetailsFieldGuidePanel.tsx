/**
 * `/details` 结果区的「设定说明」解释抽屉（魔装/奇境规则/繁开）。
 *
 * 文案是产品内容，与宿主无关——自 Web `DetailsPage` 上移，
 * 展开状态由宿主控制（Web/Desktop 都把它记入页面偏好）。
 */

export interface DetailsFieldGuideTheme {
  toggleButton: string;
  sectionTitle: string;
  sectionBody: string;
}

export const DETAILS_FIELD_GUIDE_THEME: DetailsFieldGuideTheme = {
  toggleButton: 'text-lg font-medium text-gray-800 hover:text-gray-600 transition-colors duration-200',
  sectionTitle: 'font-medium text-gray-700 mb-2',
  sectionBody: 'text-sm text-gray-700 leading-relaxed',
};

export const APP_FIELD_GUIDE_THEME: DetailsFieldGuideTheme = {
  toggleButton: 'text-lg font-medium text-(--app-text) hover:text-(--app-text-muted) transition-colors duration-200',
  sectionTitle: 'font-medium text-(--app-text) mb-2',
  sectionBody: 'text-sm text-(--app-text-muted) leading-relaxed',
};

export interface DetailsFieldGuidePanelProps {
  theme?: DetailsFieldGuideTheme;
  expanded: boolean;
  onToggle: () => void;
}

export function DetailsFieldGuidePanel({
  theme = DETAILS_FIELD_GUIDE_THEME,
  expanded,
  onToggle,
}: DetailsFieldGuidePanelProps) {
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="text-center">
        <button
          type="button"
          onClick={onToggle}
          className={theme.toggleButton}
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {expanded ? '点击收起设定说明' : '点击展开设定说明'} {expanded ? '▼' : '▶'}
        </button>
        {expanded && (
          <div className="text-left" style={{ marginTop: '1rem' }}>
            <div className="mb-4">
              <h4 className={theme.sectionTitle}>1. 魔力构装（简称魔装）</h4>
              <p className={theme.sectionBody}>
                魔法少女的本相魔力所孕育的能力具现，是魔法少女能力体系的基础。一般呈现为魔法少女在现实生活中接触过，在冥冥之中与其命运关联或映射的物体，并且与魔法少女特色能力相关。例如，泡泡机形态的魔装可以使魔法少女制造魔法泡泡，而这些泡泡可以拥有产生幻象、缓冲防护、束缚困敌等能力。这部分的内容需包含魔装的名字（通常为2字词），魔装的形态，魔装的基本能力。
              </p>
            </div>
            <div className="mb-4">
              <h4 className={theme.sectionTitle}>2. 奇境规则</h4>
              <p className={theme.sectionBody}>
                魔法少女的本相灵魂所孕育的能力，是魔装能力的一体两面。奇境是魔装能力在规则层面上的升华，体现为与魔装相关的规则领域，而规则的倾向则会根据魔法少女的倾向而有不同的发展。例如，泡泡机形态的魔装升华而来的奇境规则可以是倾向于守护的&ldquo;戳破泡泡的东西将会立即无效化&rdquo;，也可以是倾向于进攻的&ldquo;沾到身上的泡泡被戳破会立即遭受伤害&rdquo;。
              </p>
            </div>
            <div className="mb-4">
              <h4 className={theme.sectionTitle}>3. 繁开</h4>
              <p className={theme.sectionBody}>
                是魔法少女魔装能力的二段进化与解放，无论是作为魔法少女的魔力衣装还是魔装的武器外形都会发生改变。需包含繁开状态魔装名（需要包含原魔装名的每个字），繁开后的进化能力，繁开后的魔装形态，繁开后的魔法少女衣装样式（在通常变身外观上的升级与改变）。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
