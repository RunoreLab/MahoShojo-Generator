/**
 * 本地数据卡的内容摘要与 ID 派生（V1）。
 *
 * 这是 V1 语义的**唯一权威生产实现**。Web renderer 与 Desktop renderer 都是 JavaScript，
 * 两者都必须直接复用本模块，**MUST NOT** 各自维护副本——两份实现等于两份事实来源，
 * 而摘要决定本地卡身份，一处漂移就会让同一张卡在两端变成两张。
 *
 * ## 摘要覆盖什么
 *
 * 摘要**只覆盖卡内容**，不覆盖标题、作者、时间戳或云端 ID。理由很直接：如果把那些也算进摘要，
 * 用户改一次标题就会得到一张新卡，本地库会被同一张卡的每次微调填满——这正是「免得生成多个没多大
 * 差异的本地卡」要避免的结果。签名同样排除：它每次保存都会变，而内容没变。
 *
 * ## V1 冻结的 JavaScript 语义（不要"顺手修正"）
 *
 * 以下行为是 V1 已冻结的语义。它们与其它语言/运行时的默认行为不同，但**属于既有行为而不是待修
 * 缺陷**；改动其中任何一条都会改变所有历史卡的 `contentDigest` 与 `lc_` 前缀 ID。按
 * `DESK-060` / `DESK-061`，任何变更都必须作为显式新版本引入。
 *
 * | 行为 | V1 冻结值 | 与默认行为的差异 |
 * | --- | --- | --- |
 * | 对象键排序 | `left < right`，即 UTF-16 code unit 序 | 码点序（Rust `str::cmp`）把星平面字符排在 BMP 私有区之后，位置不同 |
 * | 数字 `1e-6` | `JSON.stringify` → `0.000001` | 最短往返序列化（Rust `serde_json`）→ `1e-6` |
 * | 数字 `-0` | `JSON.stringify` → `0` | `serde_json` → `-0.0` |
 * | 孤立代理项 | `JSON.stringify` 输出 `"\ud800"` 并据此计算摘要 | 不是合法 UTF-8，`serde_json` 直接拒绝解析 |
 *
 * 最后一条意味着：**V1 不接受"拒绝孤立代理项"这类收窄**。那会缩小算法的输入域，使历史上
 * 已能保存的卡在新版本里无法保存。只接受 Unicode scalar values 的口径属后续版本。
 *
 * `golden` fixture（`fixtures/local-card-digest-v1.json`）逐用例冻结上述语义，每条记录
 * `caseDescription`，因此语义一旦被改动，失败信息会直接指明是哪一条历史行为变了。
 */

/** 摘要算法标签。它同时是 `contentDigest` 的前缀，也是 ID 派生的取位依据。 */
export const LOCAL_CARD_DIGEST_ALGORITHM_V1 = 'sha256' as const;

/**
 * 每次保存都会变、但不代表内容变化的字段。它们在任何嵌套层级上都不参与摘要。
 *
 * 与 {@link LOCAL_CARD_TRANSPORT_META_KEYS} 的区别：传输元数据在下层被**剥离**（连同子树一起
 * 消失），非实质字段在上层被**跳过**（子树保留）。两者混用会让"签名嵌套对象"这类输入产生
 * 难以推理的摘要。
 */
const NON_SUBSTANTIVE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'signature',
  'signatureVersion',
  'signatureKeyId',
]);

/**
 * 竞技场选卡传输元数据。这些 `_` 前缀字段是展示层的投影，不是卡内容，因此整棵子树被剥离。
 *
 * 它们是 {@link digestLocalCardPayloadV1} 的输入前置处理的一部分：改动这个清单等同于改动摘要
 * 算法，必须走新版本。
 */
export const LOCAL_CARD_TRANSPORT_META_KEYS: ReadonlySet<string> = new Set([
  '_cardId',
  '_storageLocation',
  '_cardName',
  '_cardDescription',
  '_cardType',
  '_isPublic',
  '_updatedAt',
  '_createdAt',
  '_author',
  '_authorName',
  '_likeCount',
  '_favoriteCount',
  '_usageCount',
]);

const toPlainRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * 递归剥离传输元数据，返回结构同构的新对象。
 *
 * 重建而不是就地删除：调用方可能仍持有原对象，就地修改会让"算摘要"这件事产生副作用。
 */
export const stripLocalCardTransportMeta = <T>(input: T): T => {
  if (Array.isArray(input)) {
    return input.map((item) => stripLocalCardTransportMeta(item)) as T;
  }
  const record = toPlainRecord(input);
  if (!record) return input;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (LOCAL_CARD_TRANSPORT_META_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = stripLocalCardTransportMeta(value);
  }
  return cleaned as T;
};

/**
 * 把任意 JSON 值渲染成 V1 的 canonical 文本（SHA-256 的前像）。
 *
 * 导出它是因为 golden fixture 需要断言**前像本身**，而不只是它的摘要：只断言摘要时，
 * 前像的某个字符被改动与摘要算法被改动会给出同样的失败信息，无法定位。
 *
 * 数组保序（顺序是内容的一部分），对象按键排序（顺序不是内容的一部分）。
 */
export const canonicalizeLocalCardPayloadV1 = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalizeLocalCardPayloadV1).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !NON_SUBSTANTIVE_PAYLOAD_KEYS.has(key))
    // 冻结的 V1 语义：JS 字符串比较，即 UTF-16 code unit 序。不要替换成 localeCompare，
    // 也不要用码点序"修正"它——两者都会改变全部历史卡的摘要。
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeLocalCardPayloadV1(item)}`)
    .join(',')}}`;
};

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * 计算**原始字节**的摘要，形如 `sha256:<64 位小写 hex>`。
 *
 * 与 [`digestLocalCardPayloadV1`] 的区别是本函数**不做** canonicalize：它就是 `sha256(bytes)`。
 * 两者刻意不合并——canonicalize 是领域语义（什么算"同一张卡"），而字节摘要是存储与完整性语义
 * （blob 的存储地址、归档内 `checksum` / `archiveDigest`）。把字节摘要写成"摘要"会让调用方
 * 以为可以传对象。
 *
 * 归档导出侧需要它两次：`checksum` 覆盖记录 JSON 的确切字节，`archiveDigest` 覆盖 ZIP 字节。
 * 两者都由本函数产生，因此"归档里声明的摘要"与"归档里实际写入的字节"只有一个计算入口。
 */
export const sha256DigestOfBytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    // `crypto.subtle.digest` 要求独立 ArrayBuffer，而 `Uint8Array` 常是别的缓冲区的视图。
    // 传视图在部分 runtime 上会抛，且报错信息与根因完全无关，因此显式复制一份。
    bytes.slice().buffer,
  );
  return `${LOCAL_CARD_DIGEST_ALGORITHM_V1}:${toHex(digest)}`;
};

/**
 * 计算本地数据卡的内容摘要，形如 `sha256:<64 位小写 hex>`。
 *
 * 输入先剥离传输元数据再 canonicalize，因此同一张卡无论从哪条读取路径拿到 payload，
 * 摘要都相同。
 */
export const digestLocalCardPayloadV1 = async (payload: unknown): Promise<string> => {
  const canonical = canonicalizeLocalCardPayloadV1(stripLocalCardTransportMeta(payload));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `${LOCAL_CARD_DIGEST_ALGORITHM_V1}:${toHex(digest)}`;
};

/**
 * 由内容摘要派生本地卡 ID：算法前缀之后的前 32 位十六进制。
 *
 * 与 Web 包的 `wp_` / `local.` 派生保持同一形状，便于两类本地对象互相辨认；这也是把两者
 * 放在同一个 portable archive 里而不需要额外映射表的原因。
 *
 * 只取 32 位十六进制（128 bit）而不是全部 64 位：截断后的碰撞概率对本机规模的卡库可以忽略，
 * 而短 ID 让文件名、UI 与调试输出都可读。**改变截断长度等同于改变所有历史卡的身份。**
 */
export const deriveLocalDataCardIdV1 = (contentDigest: string): string =>
  `lc_${contentDigest.replace(/^sha256:/u, '').slice(0, 32)}`;
