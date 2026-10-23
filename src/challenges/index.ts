import { getLevel, LEVELS } from '../kitchen/levels';
import { makeOrders } from '../kitchen/orders';
import { HZ, RULES_VERSION, type Dish, type KitchenOptions, type LevelId } from '../kitchen/types';

export const CHALLENGE_SCHEMA_VERSION = 'mcrush-challenge-1' as const;
export const MAX_CHALLENGE_BYTES = 32 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
export const CHALLENGE_TEMPLATES = {
  balanced: '原味接力',
  'fryer-rush': '炸物高峰',
  'drinks-rush': '饮品高峰',
} as const;
export type ChallengeTemplate = keyof typeof CHALLENGE_TEMPLATES;
export interface PublicArticle { title: string; url: string | null }
export interface ChallengeSpec {
  schemaVersion: typeof CHALLENGE_SCHEMA_VERSION;
  rulesVersion: typeof RULES_VERSION;
  title: string;
  levelId: LevelId;
  seed: number;
  template: ChallengeTemplate;
  createdAt: string;
  expiresAt: string;
  source: { provider: 'mcd-campaign-calendar'; fetchedAt: string; articles: PublicArticle[] };
}
export interface ChallengePreview {
  title: string;
  levelName: string;
  templateName: string;
  orderCount: number;
  sourceTitles: string[];
  fetchedAt: string;
  expiresAt: string;
  disclaimer: string;
}
export type ChallengeErrorCode = 'size' | 'json' | 'shape' | 'version' | 'date' | 'expired' | 'source';
export type ChallengeResult =
  | { ok: true; spec: ChallengeSpec; preview: ChallengePreview; options: KitchenOptions }
  | { ok: false; error: { code: ChallengeErrorCode; message: string } };

class InvalidChallenge extends Error {
  constructor(readonly code: ChallengeErrorCode, message: string) { super(message); }
}
function invalid(code: ChallengeErrorCode, message: string): never { throw new InvalidChallenge(code, message); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('shape', '挑战文件的结构不正确。');
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) invalid('shape', '挑战含未知或缺少的字段，请重新生成文件。');
  return object;
}
function plainText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) invalid('shape', '挑战标题只允许有长度限制的普通文本。');
  return value.trim().normalize('NFC');
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid('date', '时间必须是完整 UTC 时间，例如 2026-10-23T07:00:00.000Z。');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid('date', '挑战包含不存在的日期。');
  return time;
}
function articleUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 400 || /[\s\\<>"']/u.test(value)) invalid('source', '来源链接不符合要求；接口没有返回链接时请使用 null。');
  let url: URL;
  try { url = new URL(value); } catch { invalid('source', '来源链接不正确。'); }
  const official = ['mcd.cn', 'mcdonalds.com.cn'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  // No query strings, fragments, credentials or arbitrary domains can enter shared files.
  // The game never fetches this URL. React/textContent must still escape all display text.
  if (!official || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) invalid('source', '来源只接受无追踪参数的麦当劳官方 HTTPS 链接。');
  try { if (/[<>"'\u0000-\u001f]/u.test(decodeURIComponent(url.pathname))) invalid('source', '来源链接含无效字符。'); }
  catch { invalid('source', '来源链接含无效字符。'); }
  return url.href;
}

/** Bounds before walking a parsed file: no recursive traversal or model-generated executable content. */
function boundedTree(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.depth > 4) invalid('shape', '挑战文件嵌套过深。');
    if (typeof node.value === 'string' && node.value.length > 512) invalid('shape', '挑战文件含过长文本。');
    if (typeof node.value === 'number' && !Number.isFinite(node.value)) invalid('shape', '挑战文件含无效数字。');
    if (node.value && typeof node.value === 'object') {
      const values = Object.values(node.value);
      if (values.length > (Array.isArray(node.value) ? 8 : 10)) invalid('shape', '挑战文件的条目过多。');
      for (const child of values) pending.push({ value: child, depth: node.depth + 1 });
    }
  }
}

/** Titles and URLs only. This deliberately knows nothing about memberships, coupons or subscriptions. */
export function deduplicateArticles(articles: readonly PublicArticle[]): PublicArticle[] {
  const result: PublicArticle[] = [];
  const seen = new Set<string>();
  for (const article of articles) {
    const title = plainText(article.title, 120), url = articleUrl(article.url);
    const key = url ?? title.replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
    if (!seen.has(key)) { seen.add(key); result.push({ title, url }); }
  }
  return result;
}

function validate(value: unknown, now: number): ChallengeSpec {
  boundedTree(value);
  const object = record(value, ['schemaVersion', 'rulesVersion', 'title', 'levelId', 'seed', 'template', 'createdAt', 'expiresAt', 'source']);
  if (object.schemaVersion !== CHALLENGE_SCHEMA_VERSION || object.rulesVersion !== RULES_VERSION) invalid('version', '挑战版本不兼容，请为当前游戏重新生成。');
  if (!LEVELS.some(level => level.id === object.levelId) || typeof object.template !== 'string' || !Object.hasOwn(CHALLENGE_TEMPLATES, object.template)) invalid('shape', '关卡或订单主题不受支持。');
  if (typeof object.seed !== 'number' || !Number.isInteger(object.seed) || object.seed < 1 || object.seed > 0xffffffff) invalid('shape', '挑战种子必须是 1 到 4294967295 的整数。');
  const source = record(object.source, ['provider', 'fetchedAt', 'articles']);
  if (source.provider !== 'mcd-campaign-calendar' || !Array.isArray(source.articles) || source.articles.length < 1 || source.articles.length > 8) invalid('source', '挑战需要至少一条可公开的活动来源，最多八条。');
  const articles = deduplicateArticles(source.articles.map(item => {
    const article = record(item, ['title', 'url']);
    return { title: plainText(article.title, 120), url: articleUrl(article.url) };
  }));
  const createdAt = timestamp(object.createdAt), expiresAt = timestamp(object.expiresAt), fetchedAt = timestamp(source.fetchedAt);
  if (!Number.isFinite(now) || fetchedAt > now + CLOCK_TOLERANCE_MS || createdAt > now + CLOCK_TOLERANCE_MS || createdAt < fetchedAt || expiresAt <= createdAt || expiresAt > fetchedAt + MAX_AGE_MS) invalid('date', '来源与生成时间不一致，或有效期超过查询后七天。');
  if (expiresAt <= now || now - fetchedAt > MAX_AGE_MS) invalid('expired', '活动快照已过期。普通三关仍可游玩；需要新主题时请主动重新查询。');
  return {
    schemaVersion: CHALLENGE_SCHEMA_VERSION, rulesVersion: RULES_VERSION, title: plainText(object.title, 48),
    levelId: object.levelId as LevelId, seed: object.seed, template: object.template as ChallengeTemplate,
    createdAt: object.createdAt as string, expiresAt: object.expiresAt as string,
    source: { provider: 'mcd-campaign-calendar', fetchedAt: source.fetchedAt as string, articles },
  };
}

/** Transform authored orders only: keep wave times, counts, channels and menu boundaries. */
function buildOptions(spec: ChallengeSpec): KitchenOptions {
  const level = getLevel(spec.levelId);
  const orders = makeOrders({ levelId: spec.levelId, seed: spec.seed }).map((order, index) => {
    const dishes = [...order.dishes];
    let featured: Dish | undefined;
    if (index % 2 === 1 && spec.template === 'drinks-rush') featured = 'cola';
    if (index % 2 === 1 && spec.template === 'fryer-rush') featured = level.menu.includes('nuggets') && index % 4 === 1 ? 'nuggets' : 'fries';
    if (featured && !dishes.includes(featured)) {
      const replace = dishes.findIndex(dish => dish !== 'cola');
      if (replace >= 0) dishes[replace] = featured;
    }
    return { dishes, arrival: order.arrival / HZ, due: order.due / HZ, ...(order.channel ? { channel: order.channel } : {}) };
  });
  return { levelId: spec.levelId, seed: spec.seed, orders };
}

/** Pure boundary: a failed import never changes a session, a stored challenge, or standard levels. */
export function parseChallenge(text: string, { now = Date.now() }: { now?: number } = {}): ChallengeResult {
  try {
    if (typeof text !== 'string' || text.length > MAX_CHALLENGE_BYTES || new TextEncoder().encode(text).byteLength > MAX_CHALLENGE_BYTES) invalid('size', '挑战文件不能超过 32 KB。');
    let value: unknown;
    try { value = JSON.parse(text); } catch { invalid('json', '无法读取挑战 JSON 文件。'); }
    const spec = validate(value, now), options = buildOptions(spec);
    return { ok: true, spec, options, preview: {
      title: spec.title, levelName: getLevel(spec.levelId).name, templateName: CHALLENGE_TEMPLATES[spec.template],
      orderCount: options.orders!.length, sourceTitles: spec.source.articles.map(article => article.title),
      fetchedAt: spec.source.fetchedAt, expiresAt: spec.expiresAt,
      disclaimer: '活动提供主题灵感；餐品、订单、时间与分数均为虚构游戏参数。来源由导入文件声明，不代表官方认证。',
    } };
  } catch (error) {
    return { ok: false, error: error instanceof InvalidChallenge ? { code: error.code, message: error.message } : { code: 'shape', message: '挑战文件不符合当前游戏规则。' } };
  }
}
