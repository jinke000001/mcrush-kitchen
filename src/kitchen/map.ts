import type { ActorId, KitchenStation, Point, StationDefinition } from './types';
export const WIDTH = 16, HEIGHT = 11;
export const SPAWNS: Record<ActorId, Point> = { player: { x: 4.5, y: 7.5 }, a: { x: 3.5, y: 3.5 }, b: { x: 11.5, y: 7.5 } };
const station = (id: string, kind: StationDefinition['kind'], label: string, x: number, y: number, zone: StationDefinition['zone'], port: Point, supply?: StationDefinition['supply']): StationDefinition => ({ id, kind, label, x, y, zone, ports: [port], ...(supply ? { supply } : {}) });
export const STATIONS: readonly StationDefinition[] = [
  station('bun', 'supply', '面包', 2, 1, 'cold', { x: 2, y: 2 }, 'bun'),
  station('meat', 'supply', '肉饼', 3, 1, 'cold', { x: 3, y: 2 }, 'rawPatty'),
  station('cheese', 'supply', '芝士', 4, 1, 'cold', { x: 4, y: 2 }, 'cheese'),
  station('potato', 'supply', '土豆', 5, 1, 'cold', { x: 5, y: 2 }, 'potato'),
  station('chicken', 'supply', '鸡肉', 6, 1, 'cold', { x: 6, y: 2 }, 'rawChicken'),
  station('chop-a', 'chop', '切配台 A', 7, 1, 'cold', { x: 7, y: 2 }),
  station('chop-b', 'chop', '切配台 B', 8, 1, 'cold', { x: 8, y: 2 }),
  station('cups', 'supply', '纸杯', 12, 1, 'drinks', { x: 12, y: 2 }, 'cup'),
  station('drink', 'drink', '可乐机', 13, 1, 'drinks', { x: 13, y: 2 }),
  station('trays', 'traySupply', '餐盒', 14, 1, 'assembly', { x: 14, y: 2 }),
  station('grill-a', 'grill', '煎台 A', 1, 4, 'hot', { x: 2, y: 4 }),
  station('grill-b', 'grill', '煎台 B', 1, 5, 'hot', { x: 2, y: 5 }),
  station('fryer-a', 'fryer', '炸锅 A', 1, 7, 'hot', { x: 2, y: 7 }),
  station('fryer-b', 'fryer', '炸锅 B', 1, 8, 'hot', { x: 2, y: 8 }),
  ...[6, 7, 8, 9].flatMap((x, i) => [
    station('pass-n' + i, 'counter', '交接台 ' + (i + 1), x, 4, 'handoff', { x, y: 3 }),
    station('pass-s' + i, 'counter', '交接台 ' + (i + 5), x, 6, 'handoff', { x, y: 7 }),
  ]),
  station('assembly-a', 'counter', '配餐台 A', 14, 4, 'assembly', { x: 13, y: 4 }),
  station('assembly-b', 'counter', '配餐台 B', 14, 5, 'assembly', { x: 13, y: 5 }),
  station('assembly-c', 'counter', '配餐台 C', 14, 6, 'assembly', { x: 13, y: 6 }),
  station('bin', 'bin', '回收桶', 14, 8, 'assembly', { x: 13, y: 8 }),
  station('serve-a', 'serve', '出餐口 A', 7, 9, 'serve', { x: 7, y: 8 }),
  station('serve-b', 'serve', '出餐口 B', 9, 9, 'serve', { x: 9, y: 8 }),
];
export const SOLID_TILES: readonly Point[] = [
  ...Array.from({ length: WIDTH }, (_, x) => [{ x, y: 0 }, { x, y: HEIGHT - 1 }]).flat(),
  ...Array.from({ length: HEIGHT - 2 }, (_, i) => [{ x: 0, y: i + 1 }, { x: WIDTH - 1, y: i + 1 }]).flat(),
  ...[6, 7, 8, 9].map(x => ({ x, y: 5 })),
];
export const KITCHEN_MAP = { id: 'mcd-handoff-3d-1', name: '开门第一班 · 传餐台', width: WIDTH, height: HEIGHT, stations: STATIONS, solidTiles: SOLID_TILES, spawns: SPAWNS } as const;
export const center = (p: Point): Point => ({ x: p.x + .5, y: p.y + .5 });
export const tile = (p: Point): Point => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
export interface NavigationMap { width: number; height: number; stations: readonly StationDefinition[]; solidTiles: readonly Point[] }
/** Each engine owns its navigation. No shared mutable grid when two levels coexist. */
export function createNavigation(map: NavigationMap) {
  const blocked = new Set([...map.solidTiles, ...map.stations].map(p => `${p.x},${p.y}`));
  const isSolid = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height || blocked.has(`${x},${y}`);
  const canStand = (p: Point, radius = .24): boolean => [-radius, radius].every(dx => [-radius, radius].every(dy => !isSolid(Math.floor(p.x + dx), Math.floor(p.y + dy))));
  function findPath(from: Point, to: Point, occupied: ReadonlySet<string> = new Set()): Point[] {
    const start = tile(from), goal = tile(to), key = (p: Point) => `${p.x},${p.y}`;
    if (isSolid(goal.x, goal.y)) return [];
    if (key(start) === key(goal)) return [to];
    const queue = [start], previous = new Map<string, Point | null>([[key(start), null]]);
    for (let i = 0; i < queue.length; i++) for (const d of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
      const next = { x: queue[i].x + d.x, y: queue[i].y + d.y }, k = key(next);
      if (isSolid(next.x, next.y) || (occupied.has(k) && k !== key(goal)) || previous.has(k)) continue;
      previous.set(k, queue[i]); queue.push(next);
      if (k === key(goal)) {
        const path: Point[] = [next]; let current = queue[i];
        while (key(current) !== key(start)) { path.unshift(current); current = previous.get(key(current))!; }
        const points = path.map(center); points[points.length - 1] = { ...to }; return points;
      }
    }
    return [];
  }
  return { isSolid, canStand, findPath };
}
// Legacy helpers describe the preserved first kitchen; runtime code uses an instance navigation.
export const { isSolid, canStand, findPath } = createNavigation(KITCHEN_MAP);
export function makeStations(definitions: readonly StationDefinition[] = STATIONS): KitchenStation[] {
  return definitions.map(s => ({ ...structuredClone(s), itemId: null, progress: 0, duration: 0, burnProgress: 0, burnDuration: 0, state: 'idle', workerId: null }));
}
