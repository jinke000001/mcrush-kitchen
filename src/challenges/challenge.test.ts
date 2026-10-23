import { describe, expect, it } from 'vitest';
import { getLevel, LEVELS } from '../kitchen/levels';
import { makeOrders } from '../kitchen/orders';
import { HZ, RULES_VERSION } from '../kitchen/types';
import { CHALLENGE_SCHEMA_VERSION, CHALLENGE_TEMPLATES, MAX_CHALLENGE_BYTES, deduplicateArticles, parseChallenge, type ChallengeSpec } from './index';
import liveExample from '../../public/challenges/fryer-rush-2026-10-23.json';

const now = Date.parse('2026-10-23T08:00:00.000Z');
function valid(): ChallengeSpec {
  return {
    schemaVersion: CHALLENGE_SCHEMA_VERSION, rulesVersion: RULES_VERSION, title: '薯香接力班', levelId: 'lunch-line', seed: 20261023,
    template: 'fryer-rush', createdAt: '2026-10-23T07:30:00.000Z', expiresAt: '2026-10-26T07:00:00.000Z',
    source: { provider: 'mcd-campaign-calendar', fetchedAt: '2026-10-23T07:00:00.000Z', articles: [{ title: '韩式风味蘸酱上新', url: null }] },
  };
}
function parse(object: unknown) { return parseChallenge(JSON.stringify(object), { now }); }
function reject(object: unknown, code?: string) {
  const result = parse(object);
  expect(result.ok).toBe(false);
  if (!result.ok && code) expect(result.error.code).toBe(code);
}

describe('bounded activity challenge import', () => {
  it('accepts the recorded live-query example at capture time and rejects it after expiry', () => {
    const result = parse(liveExample);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.source.articles).toEqual([{ title: '韩式风味蘸酱上新❤️就「酱」心有所「薯」', url: null }]);
      expect(result.options.orders!.length).toBeGreaterThan(0);
    }
    expect(parseChallenge(JSON.stringify(liveExample), { now: Date.parse(liveExample.expiresAt) })).toMatchObject({ ok: false, error: { code: 'expired' } });
  });
  it('previews a valid file without mutating its input or source', () => {
    const source = valid(), before = structuredClone(source), result = parse(source);
    expect(source).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview).toMatchObject({ title: '薯香接力班', templateName: '炸物高峰', sourceTitles: ['韩式风味蘸酱上新'] });
    expect(result.options.levelId).toBe('lunch-line');
    expect(Object.keys(result.options).sort()).toEqual(['levelId', 'orders', 'seed']);
    expect(result.spec.source.articles[0].url).toBeNull();
  });
  it('reproduces identical orders for the same challenge and does not mutate authored levels', () => {
    const before = structuredClone(LEVELS), first = parse(valid()), second = parse(valid());
    expect(first).toEqual(second);
    expect(LEVELS).toEqual(before);
    if (first.ok && second.ok) { first.options.orders![0].dishes[0] = 'cola'; expect(first.options).not.toEqual(second.options); }
  });
  it('keeps each template inside each level menu, retaining authored demand counts, wave times and windows', () => {
    for (const level of LEVELS) for (const template of Object.keys(CHALLENGE_TEMPLATES)) {
      const input = { ...valid(), levelId: level.id, template }, result = parse(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const baseline = makeOrders({ levelId: level.id, seed: input.seed });
      expect(result.options.orders).toHaveLength(baseline.length);
      result.options.orders!.forEach((order, index) => {
        expect(order.arrival).toBe(baseline[index].arrival / HZ);
        expect(order.due).toBe(baseline[index].due / HZ);
        expect(order.channel).toBe(baseline[index].channel);
        expect(order.dishes).toHaveLength(baseline[index].dishes.length);
        expect(new Set(order.dishes).size).toBe(order.dishes.length);
        expect(order.dishes.every(dish => level.menu.includes(dish))).toBe(true);
      });
    }
  });
  it('makes the chosen theme visible in recipe proportions while leaving the schedule unchanged', () => {
    const count = (template: string, dishes: string[]) => {
      const result = parse({ ...valid(), template });
      if (!result.ok) throw new Error(result.error.message);
      return result.options.orders!.flatMap(order => order.dishes).filter(dish => dishes.includes(dish)).length;
    };
    expect(count('fryer-rush', ['fries', 'nuggets'])).toBeGreaterThan(count('balanced', ['fries', 'nuggets']));
    expect(count('drinks-rush', ['cola'])).toBeGreaterThan(count('balanced', ['cola']));
  });
  it('deduplicates repeat articles, including whitespace variation and repeated official URL', () => {
    const input = valid();
    input.source.articles = [
      { title: ' 薯类上新 ', url: null }, { title: '薯类上新', url: null },
      { title: '标题 A', url: 'https://www.mcdonalds.com.cn/news/fry' }, { title: '标题 B', url: 'https://www.mcdonalds.com.cn/news/fry' },
    ];
    const result = parse(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.sourceTitles).toEqual(['薯类上新', '标题 A']);
    expect(deduplicateArticles([{ title: 'A  B', url: null }, { title: 'a b', url: null }])).toHaveLength(1);
  });
  it('rejects empty data, malformed JSON, unsupported rules, recipes and custom orders', () => {
    for (const value of [null, [], {}, '', { ...valid(), source: { ...valid().source, articles: [] } }]) reject(value);
    expect(parseChallenge('{', { now }).ok).toBe(false);
    reject({ ...valid(), rulesVersion: 'mcd-kitchen-3d-1' }, 'version');
    reject({ ...valid(), template: 'ice-cream' });
    reject({ ...valid(), levelId: 'custom-map' });
    reject({ ...valid(), orders: [{ dishes: ['dragon-burger'], arrival: 0, due: 0 }] });
  });
  it('rejects expired, impossible, future and inconsistent times instead of refreshing provenance', () => {
    reject({ ...valid(), expiresAt: '2026-10-23T08:00:00.000Z' }, 'expired');
    reject({ ...valid(), expiresAt: '2026-10-31T07:00:00.000Z' }, 'date');
    reject({ ...valid(), createdAt: '2026-02-30T07:00:00.000Z' }, 'date');
    reject({ ...valid(), createdAt: '2026-10-23' }, 'date');
    reject({ ...valid(), createdAt: '2026-10-23T10:00:00.000Z' }, 'date');
    reject({ ...valid(), createdAt: '2026-10-23T06:00:00.000Z' }, 'date');
    const stale = valid(); stale.source.fetchedAt = '2026-10-10T07:00:00.000Z'; reject(stale, 'date');
  });
  it('rejects large, deeply nested, oversized arrays and non-finite values with bounded work', () => {
    expect(parseChallenge(' '.repeat(MAX_CHALLENGE_BYTES + 1), { now })).toMatchObject({ ok: false, error: { code: 'size' } });
    expect(parseChallenge('薯'.repeat(12000), { now })).toMatchObject({ ok: false, error: { code: 'size' } });
    expect(parseChallenge('['.repeat(1000) + '0' + ']'.repeat(1000), { now }).ok).toBe(false);
    const array = valid(); array.source.articles = Array.from({ length: 9 }, () => ({ title: '标题', url: null })); reject(array);
    reject({ ...valid(), title: '薯'.repeat(49) });
    for (const seed of [0, -1, 1.5, 0x100000000, '2026', null]) reject({ ...valid(), seed });
    expect(parseChallenge(JSON.stringify(valid()).replace('20261023', '1e400'), { now }).ok).toBe(false);
  });
  it('rejects credential fields and prototype payloads at every declared boundary', () => {
    reject({ ...valid(), token: 'not-a-real-token' });
    reject({ ...valid(), source: { ...valid().source, memberId: 'not-a-member' } });
    reject({ ...valid(), source: { ...valid().source, articles: [{ title: '标题', url: null, couponId: 'no-coupon' }] } });
    const polluted = JSON.stringify(valid()).replace('"title":"薯香接力班"', '"title":"薯香接力班","__proto__":{"polluted":true}');
    expect(parseChallenge(polluted, { now }).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects executable markup, tracking URLs and lookalike official hosts', () => {
    for (const title of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '错误\u202e标题', '坏\n标题']) reject({ ...valid(), title });
    for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'https://mcd.cn.attacker.example/page', 'https://user:pass@mcd.cn/page', 'https://mcd.cn/page?token=private', 'https://mcd.cn/page#member', 'https://mcd.cn/%3Cscript%3E', 'http://mcd.cn/page', 'https://mcd.cn:8443/page']) {
      const input = valid(); input.source.articles[0].url = url; reject(input, 'source');
    }
  });
  it('returns independent accepted data so a failed next import cannot overwrite it', () => {
    const previous = parse(valid());
    const before = structuredClone(previous);
    expect(parseChallenge('invalid', { now }).ok).toBe(false);
    expect(previous).toEqual(before);
    expect(getLevel('first-shift').menu).toEqual(['burger', 'fries', 'cola']);
  });
});
