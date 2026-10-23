import { expect, it } from 'vitest';
import { KitchenAI } from './ai';
import { KitchenEngine } from './engine';
import { center } from './map';
import { KitchenRules } from './rules';
import type { KitchenEvent } from './types';

it('releases a stale assembly reservation when a player takes its input, then reuses that same public item on return', () => {
  // Bounded rule-level race fixture. Relocating actors sets up the race; movement is separately exercised by engine tests.
  const world = new KitchenEngine({ ai: false, tutorial: false, prepSeconds: 0, orders: [{ dishes: ['burger'], arrival: 0, due: 500 }] }).getSnapshot();
  world.orders[0].status = 'active'; const events: Omit<KitchenEvent, 'seq' | 'tick'>[] = [];
  const rules = new KitchenRules(world, e => events.push(e)), ai = new KitchenAI(rules), player = world.actors[0];
  const interact = (id: string) => { const s = rules.station(id); Object.assign(player, center(s.ports[0])); player.facing = { x: center(s).x - player.x, y: center(s).y - player.y }; expect(rules.interact(player, s)).toBe(true); };
  interact('bun'); interact('pass-n0'); const bunId = rules.station('pass-n0').itemId!;
  interact('meat'); interact('grill-a'); for (let t = 0; t < 420; t++) rules.machines();
  // The first AI has reserved the cooked patty and existing bun, but has not picked either up yet.
  ai.step(true); interact('pass-n0'); expect(player.heldId).toBe(bunId);
  for (let t = 0; t < 1200; t++) { world.tick++; rules.beginTick(); rules.machines(); ai.step(true); }
  expect(player.heldId).toBe(bunId); expect(rules.item(bunId)?.location).toEqual({ type: 'hand', actorId: 'player' });
  expect(world.items.filter(i => i.id === bunId)).toHaveLength(1); expect(world.orders[0].status).toBe('active');
  interact('pass-n0');
  for (let t = 0; t < 3600; t++) { world.tick++; rules.beginTick(); rules.machines(); ai.step(true); }
  expect(world.orders[0].status).toBe('served'); expect(world.items.some(i => i.id === bunId)).toBe(false);
  expect(events.some(e => e.type === 'handoff')).toBe(true);
  expect(events.filter(e => e.type === 'pickup' && e.stationId === 'bun')).toHaveLength(1);
});

// Real keyboard evidence: Mika carried a second cola after Jin had already served order #06.
it('rechecks a delivery after a teammate fills the matching order and preserves the extra food without a penalty', () => {
  const world = new KitchenEngine({ ai: false, tutorial: false, prepSeconds: 0, orders: [{ dishes: ['cola'], arrival: 0, due: 500 }] }).getSnapshot();
  world.orders[0].status = 'active';
  const events: Omit<KitchenEvent, 'seq' | 'tick'>[] = [], rules = new KitchenRules(world, event => events.push(event)), ai = new KitchenAI(rules), player = world.actors[0];
  // Race fixture: both drinks are genuinely poured; only setup walking is omitted.
  const interact = (id: string) => { const s = rules.station(id); Object.assign(player, center(s.ports[0])); player.facing = { x: center(s).x - player.x, y: center(s).y - player.y }; expect(rules.interact(player, s)).toBe(true); };
  for (const table of ['pass-s0', 'pass-s1']) {
    interact('cups'); interact('drink');
    for (let tick = 0; tick < 180; tick++) { rules.beginTick(); rules.work(player, rules.station('drink')); }
    interact('drink'); interact(table);
  }
  Object.assign(player, { x: 4.5, y: 8.5 });
  for (let tick = 0; tick < 1800; tick++) { world.tick++; world.serviceTick++; rules.beginTick(); rules.machines(); ai.step(true); }
  expect(world.metrics.served).toBe(1); expect(world.metrics.mistakes).toBe(0);
  expect(events.filter(event => event.type === 'reject')).toHaveLength(0);
  expect(world.items).toHaveLength(1); expect(world.items[0].kind).toBe('cola');
  expect(world.items[0].location.type).toBe('station');
  expect(world.stations.find(station => station.itemId === world.items[0].id)).toBeDefined();
});
