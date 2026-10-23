import { describe, expect, it } from 'vitest';
import { KitchenEngine } from './engine';
import { center } from './map';
import { HZ, type Dish, type KitchenCommand, type KitchenSnapshot, type Point } from './types';

const frame = (engine: KitchenEngine, commands: KitchenCommand[] = []) => engine.step(commands);
function wait(engine: KitchenEngine, ticks: number) { for (let i = 0; i < ticks; i++) frame(engine); }
function player(engine: KitchenEngine) { return engine.getSnapshot().actors[0]; }
function face(engine: KitchenEngine, target: Point) { const p = player(engine); frame(engine, [{ type: 'move', x: target.x - p.x, y: target.y - p.y }]); frame(engine, [{ type: 'move', x: 0, y: 0 }]); }
/** Command-level walker: the same continuous movement, collision and facing code as keyboard input. */
function go(engine: KitchenEngine, stationId: string) {
  const station = engine.level.stations.find(s => s.id === stationId)!, goal = center(station.ports[0]);
  const occupied = new Set(engine.getSnapshot().actors.slice(1).map(a => `${Math.floor(a.x)},${Math.floor(a.y)}`));
  const path = engine.navigation.findPath(player(engine), goal, occupied);
  expect(path.length, 'reachable station ' + stationId).toBeGreaterThan(0);
  for (const point of path) {
    let guard = 0;
    while (Math.hypot(player(engine).x - point.x, player(engine).y - point.y) > .08 && !(point === path.at(-1) && Math.hypot(player(engine).x - center(station).x, player(engine).y - center(station).y) < 1.2) && guard++ < 400) {
      const p = player(engine); frame(engine, [{ type: 'move', x: point.x - p.x, y: point.y - p.y }]);
    }
    expect(guard, 'walk to ' + stationId).toBeLessThan(400);
  }
  face(engine, center(station));
}
function use(engine: KitchenEngine, id: string) { go(engine, id); const preview = engine.getInteractionPreview(); expect(preview?.stationId, 'facing ' + id).toBe(id); expect(preview?.valid, preview?.reason).toBe(true); return frame(engine, [{ type: 'interact' }]); }
function untilReady(engine: KitchenEngine, id: string) {
  let guard = 0;
  while (engine.getSnapshot().stations.find(s => s.id === id)?.state !== 'ready' && guard++ < 1000) frame(engine);
  expect(guard).toBeLessThan(1000);
}
function makeBurger(engine: KitchenEngine, cheese = false) {
  use(engine, 'bun'); use(engine, 'pass-n0');
  if (cheese) { use(engine, 'cheese'); use(engine, 'pass-n0'); }
  use(engine, 'meat'); use(engine, 'grill-a'); untilReady(engine, 'grill-a'); use(engine, 'grill-a'); use(engine, 'pass-n0'); use(engine, 'pass-n0');
}
function makeFried(engine: KitchenEngine, chicken = false) {
  use(engine, chicken ? 'chicken' : 'potato'); use(engine, 'chop-a');
  frame(engine, [{ type: 'work', held: true }]); wait(engine, (chicken ? 3 : 2) * HZ); frame(engine, [{ type: 'work', held: false }]);
  use(engine, 'chop-a'); use(engine, 'fryer-a'); untilReady(engine, 'fryer-a'); use(engine, 'fryer-a');
}
function makeCola(engine: KitchenEngine) {
  use(engine, 'cups'); use(engine, 'drink'); frame(engine, [{ type: 'work', held: true }]); wait(engine, 3 * HZ); frame(engine, [{ type: 'work', held: false }]); use(engine, 'drink');
}
function makeEngine(dishes: Dish[][] = [['burger']]) { return new KitchenEngine({ levelId: 'night-relay', tutorial: false, ai: false, prepSeconds: 0, serviceSeconds: 1200, closingSeconds: 0, orders: dishes.map(d => ({ dishes: d, arrival: 0, due: 1200 })) }); }
function uniqueLocations(s: KitchenSnapshot) {
  const ids = new Set(s.items.map(i => i.id)); expect(ids.size).toBe(s.items.length);
  for (const item of s.items) {
    const refs = s.actors.filter(a => a.heldId === item.id).length + s.stations.filter(a => a.itemId === item.id).length + s.items.reduce((n, i) => n + i.contents.filter(id => id === item.id).length, 0);
    expect(refs, item.id + ' location').toBe(item.location.type === 'ground' || item.location.type === 'air' ? 0 : 1);
    const l = item.location;
    if (l.type === 'hand') expect(s.actors.find(a => a.id === l.actorId)?.heldId).toBe(item.id);
    if (l.type === 'station') expect(s.stations.find(a => a.id === l.stationId)?.itemId).toBe(item.id);
    if (l.type === 'tray') expect(s.items.find(i => i.id === l.trayId)?.contents).toContain(item.id);
  }
}

describe('kitchen commands and public food', () => {
  it('makes all five recipes through movement, actual work and machines, then corrects and delivers a three-item combo', () => {
    const e = makeEngine([['burger'], ['cheeseburger'], ['fries'], ['nuggets'], ['cola'], ['burger', 'fries', 'cola']]);
    makeBurger(e); use(e, 'serve-a');
    makeBurger(e, true); use(e, 'serve-a');
    makeFried(e); use(e, 'serve-a');
    makeFried(e, true); use(e, 'serve-a');
    makeCola(e); use(e, 'serve-a');
    expect(e.getSnapshot().metrics.served).toBe(5);
    makeBurger(e); use(e, 'assembly-a'); makeFried(e); use(e, 'assembly-b');
    use(e, 'trays'); use(e, 'assembly-a'); use(e, 'assembly-b');
    use(e, 'assembly-a');
    frame(e, [{ type: 'work', held: true }]); frame(e, [{ type: 'work', held: false }]);
    expect(e.getSnapshot().items.find(i => i.id === player(e).heldId)?.kind).toBe('fries');
    uniqueLocations(e.getSnapshot()); use(e, 'assembly-b'); use(e, 'assembly-a'); use(e, 'assembly-b');
    const held = player(e).heldId;
    use(e, 'serve-a'); expect(player(e).heldId).toBe(held); expect(e.getSnapshot().metrics.mistakes).toBe(1);
    use(e, 'assembly-a'); makeCola(e); use(e, 'assembly-a'); use(e, 'assembly-a');
    uniqueLocations(e.getSnapshot()); use(e, 'serve-a');
    expect(e.getSnapshot().metrics.served).toBe(6); expect(e.getSnapshot().items).toHaveLength(0);
    expect(e.getSnapshot().metrics.contributions.player).toBeGreaterThan(12);
  });
  it('burns unattended food, keeps wrong food, and lets the player discard and start again', () => {
    const e = makeEngine(); use(e, 'meat'); use(e, 'grill-a'); wait(e, 16 * HZ + 1);
    expect(e.getSnapshot().metrics.burnt).toBe(1); use(e, 'grill-a');
    const id = player(e).heldId; use(e, 'serve-a'); expect(player(e).heldId).toBe(id);
    use(e, 'bin'); expect(player(e).heldId).toBeNull(); expect(e.getSnapshot().items).toHaveLength(0);
    makeBurger(e); use(e, 'serve-a'); expect(e.getSnapshot().metrics.served).toBe(1);
  });
  it('cancels charged throws on focus clear, then flies ingredients through the physical world', () => {
    const e = makeEngine(); use(e, 'bun');
    frame(e, [{ type: 'throw', held: true }]); wait(e, 42); expect(player(e).throwCharge).toBe(1);
    frame(e, [{ type: 'throw', held: false, cancel: true }]); wait(e, 30); expect(player(e).heldId).not.toBeNull(); expect(player(e).throwCharge).toBe(0);
    // Throw south from the supply row toward the public floor, not through a station.
    face(e, { x: player(e).x, y: 9 }); frame(e, [{ type: 'throw', held: true }]); wait(e, 20); frame(e, [{ type: 'throw', held: false }]);
    expect(player(e).heldId).toBeNull(); expect(e.getSnapshot().items[0].location.type).toBe('air');
    wait(e, 100); expect(e.getSnapshot().items[0].location.type).not.toBe('air'); uniqueLocations(e.getSnapshot());
  });
  it('returns detached snapshots and replays the same commands exactly', () => {
    const one = makeEngine(), two = makeEngine();
    const commands: KitchenCommand[][] = [[{ type: 'move', x: 1, y: 0 }], [{ type: 'dash', held: true }], [], [{ type: 'move', x: 0, y: -1 }], [{ type: 'work', held: true }], [{ type: 'role', actorId: 'a', role: 'drinks' }]];
    for (let tick = 0; tick < 1000; tick++) { const c = commands[tick % commands.length]; one.step(c); two.step(c); }
    expect(one.getSnapshot()).toEqual(two.getSnapshot()); const copy = one.getSnapshot(); copy.actors[0].x = 999; copy.items.length = 0; expect(one.getSnapshot().actors[0].x).not.toBe(999);
    expect(one.commandLog).toEqual(two.commandLog);
  });
  it('teaches a burger and handoff, reserves combo packing for the player, then resets only after the player serves', () => {
    const e = new KitchenEngine({ tutorial: true, prepSeconds: 20 });
    makeBurger(e); use(e, 'serve-a'); expect(e.getSnapshot().tutorial?.stage).toBe('handoff');
    use(e, 'potato'); use(e, 'chop-a'); frame(e, [{ type: 'work', held: true }]); wait(e, 2 * HZ); frame(e, [{ type: 'work', held: false }]); use(e, 'chop-a'); use(e, 'pass-n0');
    // Discarding a teaching item must restore a useful next action rather than wait for a missing item.
    use(e, 'pass-n0'); use(e, 'bin'); expect(e.getGuide().stationId).toBe('potato');
    use(e, 'potato'); use(e, 'chop-a'); frame(e, [{ type: 'work', held: true }]); wait(e, 2 * HZ); frame(e, [{ type: 'work', held: false }]); use(e, 'chop-a'); use(e, 'pass-n0');
    const handedOffItem = e.getSnapshot().stations.find(station => station.id === 'pass-n0')!.itemId!;
    wait(e, 3 * HZ); expect(e.getSnapshot().stations.find(station => station.id === 'pass-n0')?.itemId).toBe(handedOffItem);
    expect(e.getGuide().title).toBe('现在指挥一次接力');
    frame(e, [{ type: 'assist', actorId: 'a', target: { type: 'item', id: handedOffItem } }]);
    let handoffGuard = 0;
    while (e.readSnapshot().actors[1].heldId !== handedOffItem && handoffGuard++ < 10 * HZ) frame(e);
    expect(handoffGuard).toBeLessThan(10 * HZ);
    frame(e, [{ type: 'assist-cancel', actorId: 'a' }]);
    for (let tick = 0; tick < 10 * HZ && e.readSnapshot().actors[1].heldId; tick++) frame(e);
    expect(e.readSnapshot().actors[1].heldId).toBeNull(); expect(e.readSnapshot().tutorial?.stage).toBe('handoff');
    expect(e.readSnapshot().items.find(item => item.id === handedOffItem)?.location.type).toBe('station');
    frame(e, [{ type: 'assist', actorId: 'a', target: { type: 'item', id: handedOffItem } }]);
    let guard = 0; while (e.getSnapshot().tutorial?.stage === 'handoff' && guard++ < 60 * HZ) frame(e);
    expect(e.getSnapshot().tutorial?.stage).toBe('combo'); expect(e.getSnapshot().metrics.handoffs).toBeGreaterThan(0);
    expect(e.getGuide().stationId).toBe('trays');
    use(e, 'trays'); expect(e.getGuide().title).toBe('把餐盒放到空台面'); use(e, 'assembly-a');
    makeCola(e); expect(e.getGuide().stationId).toBe('assembly-a'); use(e, 'assembly-a');
    // Leaving the cola with an open tray must not let AI pack or serve the lesson for the player.
    wait(e, 60 * HZ);
    expect(e.getSnapshot().tutorial?.stage).toBe('combo');
    const tray = e.getSnapshot().items.find(i => i.kind === 'tray')!;
    expect(tray.contents).toHaveLength(1);
    const cola = e.getSnapshot().items.find(i => i.kind === 'cola')!;
    expect(cola.lastHandledBy).toBe('player');
    for (const kind of ['burger', 'fries'] as const) {
      const item = e.getSnapshot().items.find(i => i.kind === kind && i.location.type === 'station');
      expect(item?.location.type).toBe('station');
      if (item?.location.type !== 'station') throw new Error('AI did not leave the completed dish on a station');
      use(e, item.location.stationId); use(e, 'assembly-a');
    }
    expect(e.getGuide().title).toBe('拿起整份套餐');
    use(e, 'assembly-a'); expect(e.getGuide().title).toBe('拿整盒出餐');
    const events = use(e, 'serve-a');
    expect(events.some(event => event.type === 'serve' && event.actorId === 'player' && event.orderId === '练习3')).toBe(true);
    expect(e.getSnapshot().phase).toBe('prep'); expect(e.getSnapshot().metrics.served).toBe(0); expect(e.getSnapshot().items).toHaveLength(0);
  });
});
