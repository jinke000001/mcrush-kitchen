import { describe, expect, it } from 'vitest';
import { KitchenEngine } from './engine';
import { canStand } from './map';
import { HZ, type KitchenSnapshot } from './types';
function invariants(s: KitchenSnapshot) {
  const ids = new Set(s.items.map(i => i.id)); expect(ids.size).toBe(s.items.length);
  for (const item of s.items) {
    const refs = s.actors.filter(a => a.heldId === item.id).length + s.stations.filter(a => a.itemId === item.id).length + s.items.reduce((n, i) => n + i.contents.filter(id => id === item.id).length, 0);
    expect(refs).toBe(item.location.type === 'ground' || item.location.type === 'air' ? 0 : 1);
    const location = item.location;
    if (location.type === 'hand') expect(s.actors.find(a => a.id === location.actorId)?.heldId).toBe(item.id);
    if (location.type === 'station') expect(s.stations.find(a => a.id === location.stationId)?.itemId).toBe(item.id);
    if (location.type === 'tray') expect(s.items.find(a => a.id === location.trayId)?.contents).toContain(item.id);
    if (item.kind === 'tray') expect(item.contents.length).toBeLessThanOrEqual(3);
  }
  for (const a of s.actors) { expect(canStand(a)).toBe(true); for (const b of s.actors) if (a.id !== b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(.4799); }
}
describe('natural service with shared physical food', () => {
  // These are simulation evidence, not human browser acceptance or a permanent exact score contract.
  // First shift is intentionally forgiving; the two later shifts add transport and wave pressure.
  it('finishes the opening service without a player, with no fake or duplicated food', () => {
    const engine = new KitchenEngine({ tutorial: false });
    const events = [];
    for (let tick = 0; tick < 304 * HZ + 1; tick++) { events.push(...engine.step()); if (tick % (2 * HZ) === 0) invariants(engine.getSnapshot()); }
    const end = engine.getSnapshot(); expect(end.phase).toBe('results'); expect(end.metrics.served).toBe(end.orders.length);
    expect(end.metrics.onTime).toBeGreaterThanOrEqual(6); expect(end.metrics.onTime).toBeLessThanOrEqual(end.metrics.served);
    expect(end.metrics.mistakes).toBe(0); expect(end.metrics.burnt).toBe(0); expect(end.metrics.handoffs).toBeGreaterThan(12);
    expect(end.metrics.contributions.a).toBeGreaterThan(10); expect(end.metrics.contributions.b).toBeGreaterThan(10);
    expect(events.filter(e => e.type === 'work').length).toBeGreaterThan(8); expect(events.filter(e => e.type === 'assemble').length).toBeGreaterThan(10);
  });
  it('keeps complete AI scheduling and physical world deterministic for identical commands', () => {
    const a = new KitchenEngine({ tutorial: false }), b = new KitchenEngine({ tutorial: false });
    for (let tick = 0; tick < 304 * HZ; tick++) {
      const commands = tick === 150 * HZ ? [{ type: 'priority' as const, orderId: '07' }] : tick === 180 * HZ ? [{ type: 'role' as const, actorId: 'b' as const, role: 'drinks' as const }] : [];
      a.step(commands); b.step(commands);
    }
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
  });
});
