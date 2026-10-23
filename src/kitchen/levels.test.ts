import { describe, expect, it } from 'vitest';
import { KitchenAI } from './ai';
import { KitchenEngine } from './engine';
import { getLevel, LEVELS } from './levels';
import { center, createNavigation } from './map';
import { makeOrders } from './orders';
import { evaluateShift } from './rating';
import { KitchenRules } from './rules';
import { HZ, type ActorId, type AssistTarget, type KitchenOptions, type KitchenSnapshot } from './types';

/** Rule-level fixtures deliberately omit walking only to isolate ownership and race transitions. */
function fixture(options: KitchenOptions = {}) {
  const world = new KitchenEngine({ tutorial: false, prepSeconds: 0, ai: false, orders: [], ...options }).getSnapshot();
  world.orders.forEach(o => { o.status = 'active'; });
  const rules = new KitchenRules(world, () => {}), ai = new KitchenAI(rules);
  const placeActor = (stationId: string, actorId: ActorId = 'player') => {
    const actor = rules.actor(actorId), station = rules.station(stationId);
    Object.assign(actor, center(station.ports[0])); actor.facing = { x: center(station).x - actor.x, y: center(station).y - actor.y };
    return actor;
  };
  const use = (stationId: string, actorId: ActorId = 'player') => { const actor = placeActor(stationId, actorId); return rules.interact(actor, rules.station(stationId)); };
  const park = () => { Object.assign(rules.actor('player'), { x: 4.5, y: 8.5, targetStationId: null }); };
  const tick = (count: number, enabled = true) => { for (let n = 0; n < count; n++) { world.tick++; rules.beginTick(); rules.machines(); rules.conveyors(); ai.step(enabled); } };
  const assist = (target: AssistTarget, actorId: 'a' | 'b' = 'a') => { const actor = rules.actor(actorId); actor.assist = { id: 1, target, status: 'received', message: 'test request', issuedAt: world.tick, updatedAt: world.tick }; };
  return { world, rules, ai, use, placeActor, park, tick, assist };
}
function ownership(world: KitchenSnapshot) {
  expect(new Set(world.items.map(i => i.id)).size).toBe(world.items.length);
  for (const item of world.items) {
    const count = world.actors.filter(a => a.heldId === item.id).length + world.stations.filter(s => s.itemId === item.id).length + world.items.reduce((n, container) => n + container.contents.filter(id => id === item.id).length, 0);
    expect(count, item.id).toBe(['air', 'ground'].includes(item.location.type) ? 0 : 1);
  }
}
function pour(f: ReturnType<typeof fixture>) {
  expect(f.use('cups')).toBe(true); expect(f.use('drink')).toBe(true);
  for (let n = 0; n < 3 * HZ; n++) { f.rules.beginTick(); f.rules.work(f.rules.actor('player'), f.rules.station('drink')); }
  expect(f.use('drink')).toBe(true);
}

describe('authored three-shift content', () => {
  it('keeps each map isolated and every station reachable with an alternate path around the conveyor', () => {
    const first = new KitchenEngine({ levelId: 'first-shift' }), night = new KitchenEngine({ levelId: 'night-relay' });
    expect(first.navigation.isSolid(7, 9)).toBe(true); expect(night.navigation.isSolid(7, 9)).toBe(false); expect(first.navigation.isSolid(4, 9)).toBe(false); expect(night.navigation.isSolid(4, 9)).toBe(true);
    for (const level of LEVELS) {
      const navigation = createNavigation(level);
      for (const station of level.stations) expect(navigation.findPath(level.spawns.player, center(station.ports[0])).length, `${level.id}:${station.id}`).toBeGreaterThan(0);
    }
    const nav = createNavigation(getLevel('lunch-line'));
    expect(nav.findPath({ x: 4.5, y: 3.5 }, { x: 11.5, y: 7.5 }).length).toBeGreaterThan(0);
  });
  it('replays authored waves, varies order composition within the same safe menus, and previews channel shifts', () => {
    for (const level of LEVELS) {
      const a = makeOrders({ levelId: level.id, seed: 1024 }), b = makeOrders({ levelId: level.id, seed: 1024 }), c = makeOrders({ levelId: level.id, seed: 22 });
      expect(a).toEqual(b); expect(a).not.toEqual(c);
      expect(a.every(o => o.dishes.every(dish => level.menu.includes(dish)) && o.arrival < level.serviceSeconds * HZ)).toBe(true);
      if (level.mechanic === 'windows') expect(a.every(o => !!o.channel)).toBe(true);
    }
    const engine = new KitchenEngine({ levelId: 'night-relay', tutorial: false, prepSeconds: 0 });
    engine.step(); expect(engine.readSnapshot().wave?.channel).toBe('takeaway'); expect(engine.readSnapshot().wave?.startsIn).toBe(66 * HZ);
  });
  it('does not duplicate or discard a full conveyor and resumes from the downstream free slot', () => {
    const f = fixture({ levelId: 'lunch-line' }), lane = getLevel('lunch-line').conveyors[0];
    for (const id of lane.stationIds) { expect(f.use('bun')).toBe(true); expect(f.use(id)).toBe(true); }
    const before = lane.stationIds.map(id => f.rules.station(id).itemId);
    f.tick(lane.ticksPerStep, false); expect(lane.stationIds.map(id => f.rules.station(id).itemId)).toEqual(before); ownership(f.world);
    expect(f.use(lane.stationIds.at(-1)!)).toBe(true); f.tick(lane.ticksPerStep, false);
    expect(lane.stationIds.map(id => f.rules.station(id).itemId)).toEqual([null, before[0], before[1], before[2]]);
    expect(f.rules.actor('player').heldId).toBe(before[3]); expect(f.world.items).toHaveLength(4); ownership(f.world);
  });
  it('retains a correct meal at the wrong window, then accepts it at the correct window', () => {
    const f = fixture({ levelId: 'night-relay', orders: [{ dishes: ['cola'], arrival: 0, due: 100, channel: 'takeaway' }] });
    pour(f); const id = f.rules.actor('player').heldId;
    f.placeActor('serve-a'); expect(f.rules.preview(f.rules.actor('player'))?.reason).toContain('右侧外带');
    expect(f.use('serve-a')).toBe(false); expect(f.rules.actor('player').heldId).toBe(id); expect(f.world.metrics.served).toBe(0);
    expect(f.use('serve-b')).toBe(true); expect(f.world.metrics.served).toBe(1); expect(f.world.mechanicProgress.correctWindowServes).toBe(1); ownership(f.world);
  });
  it('requires actually using the conveyor and both windows in untimed mechanic lessons', () => {
    const conveyor = new KitchenEngine({ levelId: 'lunch-line' }); const windows = new KitchenEngine({ levelId: 'night-relay' });
    for (let tick = 0; tick < 1000; tick++) { conveyor.step(); windows.step(); }
    expect(conveyor.readSnapshot().tutorial?.stage).toBe('conveyor'); expect(windows.readSnapshot().tutorial?.stage).toBe('windows');
    expect(conveyor.readSnapshot().serviceTick).toBe(0); expect(windows.readSnapshot().phaseRemaining).toBe(0);
  });
});

describe('one-shot teammate requests', () => {
  it('continues the exact requested public cup through actual processing and releases the instruction', () => {
    const f = fixture(); f.use('cups'); f.use('drink'); const id = f.rules.station('drink').itemId!; f.park(); f.assist({ type: 'item', id });
    f.tick(25 * HZ);
    expect(f.rules.item(id)?.kind).toBe('cola'); expect(f.rules.actor('a').assist?.status).toBe('completed'); expect(f.world.mechanicProgress.assistsCompleted).toBe(1); ownership(f.world);
  });
  it('cancels while carrying without dropping or destroying food, then safely resumes the old role', () => {
    const f = fixture(); f.use('cups'); f.use('pass-n0'); const id = f.rules.station('pass-n0').itemId!; f.park(); f.assist({ type: 'item', id });
    let guard = 0; while (f.rules.actor('a').heldId !== id && guard++ < 10 * HZ) f.tick(1);
    expect(guard).toBeLessThan(10 * HZ); f.ai.cancelAssist(f.rules.actor('a'));
    expect(f.rules.actor('a').heldId).toBe(id); expect(f.rules.actor('a').assist?.status).toBe('cancelled');
    f.tick(20 * HZ); expect(f.rules.actor('a').heldId).toBeNull(); expect(f.rules.item(id)).toBeDefined(); ownership(f.world);
  });
  it('releases a request after its input is taken away and can accept that same item on a new request', () => {
    const f = fixture(); f.use('cups'); f.use('drink'); const id = f.rules.station('drink').itemId!; f.park(); f.assist({ type: 'item', id }); f.tick(1);
    f.use('drink'); f.park(); f.tick(2); expect(f.rules.actor('a').assist?.status).toBe('failed'); expect(f.rules.actor('player').heldId).toBe(id);
    f.use('drink'); f.park(); f.assist({ type: 'item', id }); f.tick(25 * HZ);
    expect(f.rules.actor('a').assist?.status).toBe('completed'); expect(f.rules.item(id)?.kind).toBe('cola'); ownership(f.world);
  });
  it('keeps only one instruction, rejects missing targets, and cancels through the public command API', () => {
    const engine = new KitchenEngine({ tutorial: false });
    engine.step([{ type: 'assist', actorId: 'a', target: { type: 'station', id: 'drink' } }]);
    const first = engine.readSnapshot().actors[1].assist?.id;
    engine.step([{ type: 'assist', actorId: 'a', target: { type: 'order', id: '01' } }]);
    expect(engine.readSnapshot().actors[1].assist?.id).not.toBe(first);
    engine.step([{ type: 'assist-cancel', actorId: 'a' }]); expect(engine.readSnapshot().actors[1].assist?.status).toBe('cancelled');
    engine.step([{ type: 'assist', actorId: 'a', target: { type: 'item', id: 'gone' } }]); expect(engine.readSnapshot().actors[1].assist?.status).toBe('failed');
  });
  it('uses actual delivery outcomes for stars rather than granting rewards for activity counts', () => {
    const engine = new KitchenEngine({ tutorial: false, orders: [{ dishes: ['cola'], arrival: 0, due: 100 }] });
    const snapshot = engine.getSnapshot(); snapshot.metrics.contributions.player = 9999;
    expect(evaluateShift(snapshot).stars).toBe(0); snapshot.orders[0].status = 'served'; snapshot.orders[0].servedAt = 100;
    expect(evaluateShift(snapshot).stars).toBe(3); snapshot.orders[0].servedAt = 101 * HZ;
    expect(evaluateShift(snapshot).stars).toBe(1); expect(evaluateShift(snapshot).reasons[0]).toContain('迟到');
  });
});

describe('physical training and recovery regressions', () => {
  function use(engine: KitchenEngine, id: string) {
    const station = engine.level.stations.find(s => s.id === id)!, goal = center(station.ports[0]);
    const path = engine.navigation.findPath(engine.readSnapshot().actors[0], goal, new Set(engine.readSnapshot().actors.slice(1).map(a => `${Math.floor(a.x)},${Math.floor(a.y)}`)));
    expect(path.length).toBeGreaterThan(0);
    for (const point of path) {
      let guard = 0;
      while (Math.hypot(engine.readSnapshot().actors[0].x - point.x, engine.readSnapshot().actors[0].y - point.y) > .08 && guard++ < 400) {
        const actor = engine.readSnapshot().actors[0]; engine.step([{ type: 'move', x: point.x - actor.x, y: point.y - actor.y }]);
      }
      expect(guard, id).toBeLessThan(400);
    }
    const actor = engine.readSnapshot().actors[0];
    engine.step([{ type: 'move', x: center(station).x - actor.x, y: center(station).y - actor.y }]);
    engine.step([{ type: 'move', x: 0, y: 0 }]);
    expect(engine.getInteractionPreview()?.stationId).toBe(id);
    return engine.step([{ type: 'interact' }]);
  }
  function cola(engine: KitchenEngine) {
    use(engine, 'cups'); use(engine, 'drink');
    engine.step([{ type: 'work', held: true }]); for (let tick = 0; tick < 3 * HZ; tick++) engine.step();
    engine.step([{ type: 'work', held: false }]); use(engine, 'drink');
  }
  it('completes the conveyor and dual-window lessons through physical commands before the clock starts', () => {
    const conveyor = new KitchenEngine({ levelId: 'lunch-line' });
    cola(conveyor); let held = conveyor.readSnapshot().actors[0].heldId;
    use(conveyor, 'serve-a'); expect(conveyor.readSnapshot().actors[0].heldId).toBe(held);
    // Loading from the middle must not consume the only tutorial order and strand the lesson.
    use(conveyor, 'pass-n1'); for (let n = 0; n < 6 * HZ; n++) conveyor.step();
    use(conveyor, 'pass-n3'); use(conveyor, 'serve-a');
    expect(conveyor.readSnapshot().actors[0].heldId).toBe(held); expect(conveyor.readSnapshot().orders[0].status).toBe('active');
    expect(conveyor.getGuide().stationId).toBe('pass-n0');
    use(conveyor, 'bin'); expect(conveyor.getGuide().stationId).toBe('cups');
    cola(conveyor); held = conveyor.readSnapshot().actors[0].heldId;
    use(conveyor, 'pass-n0'); for (let n = 0; n < 6 * HZ; n++) conveyor.step();
    expect(conveyor.readSnapshot().stations.find(s => s.id === 'pass-n3')?.itemId).toBe(held);
    use(conveyor, 'pass-n3'); use(conveyor, 'serve-a');
    expect(conveyor.readSnapshot().phase).toBe('prep'); expect(conveyor.readSnapshot().serviceTick).toBe(0);
    expect(conveyor.readSnapshot().phaseRemaining).toBe(20 * HZ);
    const windows = new KitchenEngine({ levelId: 'night-relay' });
    cola(windows); use(windows, 'serve-b'); expect(windows.readSnapshot().tutorial?.step).toBe(1);
    use(windows, 'serve-a'); expect(windows.readSnapshot().tutorial?.step).toBe(2);
    cola(windows); use(windows, 'serve-a'); expect(windows.readSnapshot().tutorial?.step).toBe(2);
    use(windows, 'serve-b'); expect(windows.readSnapshot().phase).toBe('prep'); expect(windows.readSnapshot().metrics.served).toBe(0);
  });
  it('consolidates complementary partial boxes once, without taking food back from a completed box', () => {
    const f = fixture({ orders: [{ dishes: ['cola', 'cola'], arrival: 0, due: 500 }] });
    f.use('trays'); f.use('assembly-a'); f.use('trays'); f.use('assembly-b');
    pour(f); f.use('assembly-a'); pour(f); f.use('assembly-b'); f.park();
    f.tick(60 * HZ);
    expect(f.world.metrics.served).toBe(1); expect(f.world.metrics.mistakes).toBe(0);
    expect(f.world.metrics.contributions.a + f.world.metrics.contributions.b).toBeLessThan(10); ownership(f.world);
  });
  it('finishes a single order request exactly once and recovers with a player occupying a station port', () => {
    const f = fixture({ orders: [{ dishes: ['cola'], arrival: 0, due: 500 }] });
    pour(f); f.use('assembly-a'); f.assist({ type: 'order', id: '01' });
    // Remain at the default interaction port. AI must approach from an adjacent safe position.
    f.tick(45 * HZ);
    expect(f.world.metrics.served).toBe(1); expect(f.rules.actor('a').assist?.status).toBe('completed');
    expect(f.world.mechanicProgress.assistsCompleted).toBe(1);
    f.tick(10 * HZ); expect(f.world.mechanicProgress.assistsCompleted).toBe(1); ownership(f.world);
  });
});

it('keeps three simultaneous levels and assist commands deterministic without cloning the render view', () => {
  for (const level of LEVELS) {
    const a = new KitchenEngine({ levelId: level.id, tutorial: false, prepSeconds: 0 }), b = new KitchenEngine({ levelId: level.id, tutorial: false, prepSeconds: 0 });
    expect(a.readSnapshot()).toBe(a.readSnapshot()); const detached = a.getSnapshot(); detached.actors[0].x = 999;
    expect(a.readSnapshot().actors[0].x).not.toBe(999);
    for (let tick = 0; tick < 90 * HZ; tick++) {
      const commands = tick === 120 ? [{ type: 'assist' as const, actorId: 'a' as const, target: { type: 'order' as const, id: '01' } }] : tick === 300 ? [{ type: 'assist-cancel' as const, actorId: 'a' as const }] : [];
      a.step(commands); b.step(commands);
    }
    expect(a.getSnapshot()).toEqual(b.getSnapshot()); ownership(a.getSnapshot());
  }
});


it('follows an assisted item when its conveyor advances instead of treating it as stolen', () => {
  const f = fixture({ levelId: 'lunch-line' }); f.use('cups'); f.use('pass-n0');
  const id = f.rules.station('pass-n0').itemId!; f.world.tick = 88; f.park(); f.assist({ type: 'item', id }, 'b');
  f.tick(2); expect(f.rules.item(id)?.location).toEqual({ type: 'station', stationId: 'pass-n1' });
  expect(f.rules.actor('b').assist?.status).toBe('executing');
  f.tick(30 * HZ); expect(f.rules.item(id)?.kind).toBe('cola'); expect(f.rules.actor('b').assist?.status).toBe('completed'); ownership(f.world);
});

it('follows an assisted assembly base when the destination advances on the conveyor', () => {
  const f = fixture({ levelId: 'lunch-line' });
  f.use('meat'); f.use('grill-a'); f.tick(7 * HZ, false); f.use('grill-a'); f.use('pass-s0');
  f.use('bun'); f.use('pass-n0'); const bunId = f.rules.station('pass-n0').itemId!;
  f.world.tick = 88; f.park(); f.assist({ type: 'item', id: bunId }); f.tick(30 * HZ);
  expect(f.rules.item(bunId)?.kind).toBe('burger'); expect(f.rules.actor('a').assist?.status).toBe('completed'); ownership(f.world);
});

it('routes around an occupied approach tile instead of oscillating against a stationary player', () => {
  const f = fixture({ orders: [{ dishes: ['cola'], arrival: 0, due: 500 }] });
  pour(f); f.use('assembly-a'); const id = f.rules.station('assembly-a').itemId!;
  Object.assign(f.rules.actor('player'), { x: 13.5, y: 4.884, targetStationId: null });
  Object.assign(f.rules.actor('a'), { x: 13.5, y: 6.228 });
  f.assist({ type: 'item', id }); f.tick(45 * HZ);
  expect(f.world.metrics.served).toBe(1); expect(f.rules.actor('a').assist?.status).toBe('completed'); ownership(f.world);
});
