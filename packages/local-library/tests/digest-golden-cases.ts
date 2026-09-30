/**
 * V1 摘要 golden fixture 的用例定义。
 *
 * 本文件只声明**输入**与**该输入锁定了哪一种历史行为**；期望值由
 * `regenerate-digest-fixture.ts` 从当前实现导出到 fixture，测试再断言 fixture。
 *
 * 为什么不把期望值手写在这里：SHA-256 无法手算，而手抄的期望值既可能算错，也可能与实现
 * 一起被改错——那样 fixture 就再也拦不住任何东西。由实现生成、由测试断言，fixture 才能真正
 * 充当" unintentional 改动"的探测器。
 *
 * 但它**拦不住**"有人同时改了实现并重新生成了 fixture"。这是刻意的取舍：那份 diff 必须靠
 * code review 与 `caseDescription` 拦住，因此每条用例都必须写清它锁定的是哪条历史语义。
 *
 * 新增用例的流程：在此追加一条 → 运行 `pnpm --filter @mahoshojo/local-library run
 * fixture:regenerate` → 提交 fixture 与本文件。
 */

export interface DigestGoldenCaseInput {
  /** fixture 内的稳定标识。`sameDigestAs` 引用它，因此改名等同于改写引用关系。 */
  readonly id: string;
  /**
   * 这条用例锁定哪一种 V1 历史行为。
   *
   * 这是 fixture 里最重要的一列：摘要相同时失败信息只会给出两个哈希，无法指出被改动的是
   * 排序规则、数字格式还是剥离清单。写清楚它，失败时才可能被人读懂。
   */
  readonly caseDescription: string;
  readonly input: unknown;
  /** 期望与另一条用例产出相同摘要（用于表达"这些字段不参与摘要"）。 */
  readonly sameDigestAs?: string;
}

export const localCardDigestGoldenCases: readonly DigestGoldenCaseInput[] = [
  {
    id: 'ascii-flat-object',
    caseDescription: 'ASCII 基础形态：键按 UTF-16 升序（此处恰好与码点序一致），值原样 JSON 序列化。',
    input: { name: 'Homura', age: 15, active: true },
  },
  {
    id: 'ascii-key-order-swapped',
    caseDescription:
      '键的插入顺序不参与摘要：本条与 ascii-flat-object 内容相同、书写顺序不同，摘要必须相同。' +
      '若 canonicalize 退化为 JSON.stringify 的插入序，这条会与 ascii-flat-object 分叉。',
    input: { active: true, age: 15, name: 'Homura' },
    sameDigestAs: 'ascii-flat-object',
  },
  {
    id: 'cjk-keys-and-values',
    caseDescription: '中文键与中文值按原样进入 canonical 文本，不做 \\u 转义、不做 NFC 归一化。',
    input: { 姓名: '焰', 称号: '魔法少女', 喜欢: ['草莓蛋糕', '广播体操'] },
  },
  {
    id: 'astral-plane-emoji-key',
    caseDescription: '非 BMP 键（U+1F600 表情）按 UTF-16 代理对首码元 0xD83D 参与排序。',
    input: { '\u{1f600}': 'first' },
  },
  {
    id: 'sort-utf16-vs-codepoint-fffd-vs-emoji',
    caseDescription:
      'UTF-16 code unit 序与码点序的分歧点：U+FFFD 的码元是 0xFFFD，而 U+1F600 的首个代理码元是 ' +
      '0xD83D。V1 按码元序，故 U+FFFD 排在表情**之后**；若改成码点序则排在之前，本条摘要随之改变。' +
      '这是 spec 要求覆盖"非 BMP 字符"真正要保护的东西——只测单个 emoji 是测不出来的。',
    input: { '\ufffd': 1, '\u{1f600}': 2 },
  },
  {
    id: 'sort-utf16-vs-codepoint-private-use',
    caseDescription:
      '同一条分歧的第二个方向：U+E000（私用区，BMP 高位）与表情在 UTF-16 序下表情在前，' +
      '在码点序下 U+E000 在前。注意 U+E000 是不可见字符，canonical 文本里肉眼看不到它。',
    input: { '\ue000': 1, '\u{1f600}': 2 },
  },
  {
    id: 'number-exponent-small-threshold',
    caseDescription:
      'JSON.stringify 的指数阈值：1e-6 输出 0.000001，而 1e-7 输出 1e-7。' +
      '最短往返序列化（Rust serde_json 用的 ryu）对两者都输出 1e-6 / 1e-7 形式，因此本条在' +
      '非 JavaScript 运行时下会分叉。',
    input: { a: 1e-6, b: 1e-7 },
  },
  {
    id: 'number-exponent-large',
    caseDescription: '大指数的 JSON.stringify 形式带正号：1e21 → 1e+21。',
    input: { a: 1e21 },
  },
  {
    id: 'number-negative-zero',
    caseDescription: 'JSON.stringify(-0) 输出 0 而不是 -0；负零因此与正零同摘要。serde_json 会输出 -0.0。',
    input: { a: -0, b: 0, c: [-0] },
  },
  {
    id: 'number-fraction-and-precision',
    caseDescription: '常规小数的最短往返表示，以及 1.5e-10 这类不带前导零的指数形式。',
    input: { a: 0.1, b: 1.5e-10, c: 1 / 3 },
  },
  {
    id: 'lone-surrogate-scalar',
    caseDescription:
      '孤立代理项 U+D800 的 V1 行为：canonical 文本是 JSON.stringify 产出的 8 个 ASCII 字符 ' +
      '"\\ud800"（含两侧引号），摘要就取这串 ASCII 的 UTF-8 字节。' +
      '注意 TextEncoder 的"未配对代理项替换为 U+FFFD"规则在这里**不生效**——' +
      '因为 JSON.stringify 已经把代理项转义成 ASCII 文本，编码器看不到任何代理项。' +
      'V1 接受该输入并给出稳定摘要；不得以"拒绝非法 Unicode"为由收窄输入域，那属新版本。',
    input: '\ud800',
  },
  {
    id: 'lone-surrogate-in-object',
    caseDescription: '对象值位置上的孤立代理项，与标量位置的 canonical 文本形态对照。',
    input: { label: '\ud83d', note: 'high surrogate without its pair' },
  },
  {
    id: 'escapes-and-control-characters',
    caseDescription:
      '控制字符沿用 JSON.stringify 的转义：\\b \\t \\n \\f \\r 用短形式，其余 < 0x20 用 \\u00XX；' +
      'U+007F 与 U+2028 不转义（U+2028 只在 JavaScript 源码字面量里有特殊含义）。',
    input: { raw: 'a\u0000b\u001fc\u007fd\u2028e' },
  },
  {
    id: 'quote-and-backslash-escaping',
    caseDescription: '键与值中的双引号与反斜杠按 JSON.stringify 转义，避免 canonical 文本产生歧义。',
    input: { 'quote"key': 'back\\slash', 'both"\\': '"\\' },
  },
  {
    id: 'empty-structures',
    caseDescription: '空对象与空数组的 canonical 形态，以及 null 与数字 0 的区分。',
    input: { obj: {}, arr: [], nil: null, zero: 0, empty: '' },
  },
  {
    id: 'array-order-matters',
    caseDescription: '数组保序：[1,2,3] 与 [3,2,1] 摘要不同。对象排序但数组不排序——这是刻意的。',
    input: { seq: [3, 2, 1] },
  },
  {
    id: 'array-order-reversed',
    caseDescription: '与 array-order-matters 构成对照：仅数组元素顺序不同。',
    input: { seq: [1, 2, 3] },
  },
  {
    id: 'nested-objects-deep',
    caseDescription: '多层嵌套时每一层对象各自按键排序，排序不跨层级传播。',
    input: { z: { b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } }, a: 0 },
  },
  {
    id: 'signature-fields-stripped',
    caseDescription:
      '非实质签名字段在任何层级都不参与摘要：signature / signatureVersion / signatureKeyId。' +
      '它们每次保存都会变而内容没变，因此本条必须与 no-signature 同摘要。',
    input: { title: '焰', signature: 'sig-a', signatureVersion: 2, signatureKeyId: 'k1' },
    sameDigestAs: 'no-signature',
  },
  {
    id: 'no-signature',
    caseDescription: 'signature-fields-stripped 的对照基线：同样内容但不带签名字段。',
    input: { title: '焰' },
  },
  {
    id: 'signature-nested-subtree-skipped',
    caseDescription:
      '签名字段命中时其**整棵子树**被跳过而不是逐层过滤：' +
      '{ meta: { signature: "s", keep: 1 } } 与 { meta: { keep: 1 } } 同摘要。' +
      '注意这与传输元数据的"剥离子树"是同一形状，二者只在命中条件上不同。',
    input: { meta: { signature: 's', keep: 1 } },
    sameDigestAs: 'signature-nested-subtree-skipped-baseline',
  },
  {
    id: 'signature-nested-subtree-skipped-baseline',
    caseDescription: 'signature-nested-subtree-skipped 的对照基线。',
    input: { meta: { keep: 1 } },
  },
  {
    id: 'transport-meta-stripped',
    caseDescription:
      '竞技场选卡传输元字段（_cardId / _usageCount 等）整棵子树被剥离，本条必须与 no-transport-meta 同摘要。',
    input: { title: '焰', _cardId: 'uuid-1', _usageCount: 7, _author: 'alice' },
    sameDigestAs: 'no-transport-meta',
  },
  {
    id: 'no-transport-meta',
    caseDescription: 'transport-meta-stripped 的对照基线。',
    input: { title: '焰' },
  },
  {
    id: 'underscore-content-field-preserved',
    caseDescription:
      '内容层的 `_` 扩展字段**不是**传输元数据，必须参与摘要：`_battle_story` 变化会改变摘要。' +
      '把 `_` 前缀一律当作传输元数据会静默改变全部情景卡的身份，是本函数最容易被误改的地方。',
    input: { title: '固定章节情景', _battle_story: { total_chapters: 5, plan_mode: 'fixed' } },
  },
  {
    id: 'transport-meta-nested-removed',
    caseDescription:
      '传输元字段在嵌套层级同样被整棵剥离：本条剥掉 nested._cardDescription 整棵子树，' +
      '因此与 nested 只剩 keep 的基线同摘要。',
    input: { nested: { _cardDescription: '展示层文案', keep: 1 } },
    sameDigestAs: 'transport-meta-nested-baseline',
  },
  {
    id: 'transport-meta-nested-baseline',
    caseDescription: 'transport-meta-nested-removed 的对照基线。',
    input: { nested: { keep: 1 } },
  },
  {
    id: 'realistic-character-card',
    caseDescription:
      '贴近真实数据卡的一条：多层嵌套 + 数组 + 中英文混合 + 若干传输元字段，' +
      '用于确认组合场景下前像仍可复现。',
    input: {
      name: '焰',
      codename: '焰',
      appearance: { outfit: '粉色双马尾', colorScheme: ['粉', '白'], overallLook: '认真' },
      abilities: { special: '闪光', physical: '棒棒糖' },
      items: [{ name: '魔杖', effect: '发射光束' }],
      debutLines: '为了正义！',
      _cardId: 'card-42',
      _likeCount: 12,
    },
  },
];
