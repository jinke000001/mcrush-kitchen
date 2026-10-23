import { RULES_VERSION, type KitchenSnapshot, type LevelId } from '../kitchen/types';
export type Quality = 'high' | 'balanced' | 'performance';
export interface VisualPreferences { quality: Quality; reducedEffects: boolean; labels: boolean }
export interface BestShift { score: number; stars: number; seed: number; served: number; onTime: number }
const PREFS = 'mcrush-visual-2', SCORES = 'mcrush-scores-' + RULES_VERSION;
export function loadPreferences(): VisualPreferences {
  const fallback: VisualPreferences = { quality: 'balanced', reducedEffects: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, labels: true };
  try { const data = JSON.parse(localStorage.getItem(PREFS) ?? 'null'); if (data && ['high','balanced','performance'].includes(data.quality)) return { quality: data.quality, reducedEffects: data.reducedEffects === true, labels: data.labels !== false }; } catch { /* Optional preferences. */ }
  return fallback;
}
export function savePreferences(p: VisualPreferences) { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* In-memory settings remain usable. */ } }
export function loadScores(): Partial<Record<LevelId, BestShift>> {
  try {
    const data = JSON.parse(localStorage.getItem(SCORES) ?? '{}'), result: Partial<Record<LevelId, BestShift>> = {};
    for (const id of ['first-shift','lunch-line','night-relay'] as const) {
      const x = data?.[id];
      if (x && ['score','stars','seed','served','onTime'].every(k => Number.isInteger(x[k]) && x[k] >= 0) && x.stars <= 3 && x.seed <= 4294967295 && x.score <= 1000000 && x.served <= 100 && x.onTime <= x.served) result[id] = { score:x.score, stars:x.stars, seed:x.seed, served:x.served, onTime:x.onTime };
    }
    return result;
  } catch { return {}; }
}
export function recordShift(w: KitchenSnapshot): boolean {
  if (w.phase !== 'results' || !w.shiftRating) return false;
  const scores=loadScores(), best=scores[w.levelId];
  scores[w.levelId] = { score:Math.max(best?.score ?? 0,w.metrics.score), stars:Math.max(best?.stars ?? 0,w.shiftRating.stars), seed: !best || w.metrics.score >= best.score ? w.seed : best.seed, served:Math.max(best?.served ?? 0,w.metrics.served), onTime:Math.max(best?.onTime ?? 0,w.metrics.onTime) };
  try { localStorage.setItem(SCORES,JSON.stringify(scores));return true; } catch { return false; }
}
