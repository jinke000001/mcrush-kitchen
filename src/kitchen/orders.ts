import { getLevel } from './levels';
import { HZ, type Dish, type KitchenOptions, type KitchenOrder } from './types';
function random(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function makeOrders(options: KitchenOptions): KitchenOrder[] {
  const rnd = random(options.seed ?? 1024), level = getLevel(options.levelId), duration = options.serviceSeconds ?? level.serviceSeconds;
  const authored = options.orders ?? level.waves.flatMap(wave => {
    // Shuffle templates inside each authored wave: timing, demand and fairness are preserved.
    const templates: Dish[][] = wave.templates.map(template => [...template]);
    for (let index = templates.length - 1; index > 0; index--) { const other = Math.floor(rnd() * (index + 1)); [templates[index], templates[other]] = [templates[other], templates[index]]; }
    return templates.map((dishes, i) => {
      const arrival = (wave.arrival + i * wave.spacing) * duration / level.serviceSeconds;
      return { dishes, arrival, due: Math.min(arrival + wave.patience, duration + level.closingSeconds), channel: wave.channel, waveId: wave.id };
    });
  });
  return authored.map((o, i) => ({ id: String(i + 1).padStart(2, '0'), dishes: [...o.dishes], arrival: Math.round(o.arrival * HZ), due: Math.round(o.due * HZ), channel: o.channel, waveId: 'waveId' in o ? String(o.waveId) : undefined, status: 'forecast', servedAt: null, servedBy: null, points: 0 }));
}
