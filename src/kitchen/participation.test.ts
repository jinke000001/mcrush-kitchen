import { expect, it } from 'vitest';
import { KitchenEngine } from './engine';
import { LEVELS } from './levels';
import { center } from './map';
import { HZ, type KitchenCommand, type Point } from './types';

type Task = { stationId: string; action: 'take' | 'put' | 'work'; kind?: string };
function run(levelId: (typeof LEVELS)[number]['id'], mode: 'idle' | 'prep' | 'cooperate') {
  const engine = new KitchenEngine({ levelId, tutorial: false }), level = engine.level;
  let tasks: Task[] = [], path: Point[] = [], route = '', routeAt = 0;
  const move = (x: number, y: number): KitchenCommand => ({ type: 'move', x, y });
  for (let tick = 0; tick <= (level.prepSeconds + level.serviceSeconds + level.closingSeconds) * HZ; tick++) {
    const world = engine.readSnapshot(), player = world.actors[0], held = world.items.find(i => i.id === player.heldId);
    const commands: KitchenCommand[] = [];
    if (mode !== 'idle') {
      if (mode === 'cooperate' && tick % (15 * HZ) === 0 && world.phase !== 'prep') {
        const urgent = world.orders.find(o => ['active', 'late'].includes(o.status));
        if (urgent && (!world.actors[1].assist || ['completed', 'failed', 'cancelled'].includes(world.actors[1].assist.status))) commands.push({ type: 'assist', actorId: 'a', target: { type: 'order', id: urgent.id } });
      }
      if (!tasks.length) {
        if (held) {
          const table = world.stations.find(s => s.kind === 'counter' && !s.conveyorId && !s.itemId && s.zone === 'assembly');
          if (table) tasks = [{ stationId: table.id, action: 'put' }];
        } else {
          const machine = world.stations.find(s => s.id === 'drink')!, item = world.items.find(i => i.id === machine.itemId);
          const demand = world.orders.filter(o => o.status !== 'served' && o.status !== 'missed' && o.arrival <= world.serviceTick + 35 * HZ).flatMap(o => o.dishes).filter(d => d === 'cola').length;
          const supply = world.items.filter(i => i.kind === 'cola' || i.kind === 'cup').length;
          if (item && ['cup', 'cola'].includes(item.kind)) tasks = [{ stationId: 'drink', action: 'work' }, { stationId: 'drink', action: 'take', kind: 'cola' }];
          else if (demand > supply && !machine.itemId) tasks = [{ stationId: 'cups', action: 'take', kind: 'cup' }, { stationId: 'drink', action: 'put' }, { stationId: 'drink', action: 'work' }, { stationId: 'drink', action: 'take', kind: 'cola' }];
        }
      }
      const task = tasks[0];
      if (task) {
        const station = world.stations.find(s => s.id === task.stationId)!, item = world.items.find(i => i.id === station.itemId);
        const stale = task.action === 'take' && (held || (station.kind !== 'supply' && item?.kind !== task.kind)) || task.action === 'put' && (!held || !!station.itemId) || task.action === 'work' && (held || !item || !['cup', 'cola'].includes(item.kind));
        if (stale) { tasks = []; commands.push(move(0, 0), { type: 'work', held: false }); }
        else {
          const goal = center(station.ports[0]);
          if (Math.hypot(player.x - center(station).x, player.y - center(station).y) < 1.22) {
            const preview = engine.getInteractionPreview();
            if (preview?.stationId !== station.id) commands.push(move(center(station).x - player.x, center(station).y - player.y));
            else {
              commands.push(move(0, 0), { type: 'dash', held: false });
              if (task.action === 'work' && item?.kind === 'cup') commands.push({ type: 'work', held: true });
              else { commands.push({ type: 'work', held: false }); if (task.action !== 'work') commands.push({ type: 'interact' }); tasks.shift(); path = []; route = ''; }
            }
          } else {
            if (route !== task.stationId || tick - routeAt > 25 || !path.length) { path = engine.navigation.findPath(player, goal, new Set(world.actors.slice(1).map(a => `${Math.floor(a.x)},${Math.floor(a.y)}`))); if (!path.length) path = engine.navigation.findPath(player, goal); route = task.stationId; routeAt = tick; }
            while (path[0] && Math.hypot(player.x - path[0].x, player.y - path[0].y) < .08) path.shift();
            if (path[0]) commands.push(move(path[0].x - player.x, path[0].y - player.y), { type: 'dash', held: true }, { type: 'work', held: false }); else commands.push(move(0, 0));
          }
        }
      } else commands.push(move(0, 0), { type: 'work', held: false });
    }
    engine.step(commands);
  }
  return engine.getSnapshot();
}
it('compares identical-seed participation policies using physical commands (not a human playtest)', () => {
  for (const level of LEVELS) {
    for (const mode of ['idle', 'prep', 'cooperate'] as const) {
      const world = run(level.id, mode);
      console.log('BALANCE', level.id, mode, JSON.stringify({ served: world.metrics.served, onTime: world.metrics.onTime, total:world.orders.length, score:world.metrics.score, stars:world.shiftRating?.stars, mistakes:world.metrics.mistakes, contributions:world.metrics.contributions, assists:world.mechanicProgress.assistsCompleted }));
      expect(world.phase).toBe('results'); expect(world.metrics.mistakes).toBe(0);
      if (mode === 'idle' && level.id !== 'first-shift') expect(world.shiftRating!.stars).toBeLessThan(3);
    }
  }
});
