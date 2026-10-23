import { expect, type Page } from '@playwright/test';
import { center, createNavigation } from '../src/kitchen/map';
import { getLevel } from '../src/kitchen/levels';
import type { InteractionPreview, KitchenCommand, KitchenGuide, KitchenSnapshot, Point, ItemKind } from '../src/kitchen/types';
interface KitchenHook {
  snapshot(): KitchenSnapshot; guide(): KitchenGuide; preview(): InteractionPreview | null; paused(): boolean;
  performance(): { scope:string; samples:number; elapsedSeconds:number; p95:number|null; p99:number|null; max:number|null; stalls:number; rendering:unknown };
  audio(): unknown; commandLog(): { tick: number; command: KitchenCommand }[];
}
declare global { interface Window { __MCKITCHEN__?: KitchenHook } }
const recovered = new WeakMap<Page, number>();
export const readKitchen = (page: Page) => page.evaluate(() => window.__MCKITCHEN__!.snapshot());
export async function recoverStall(page: Page) {
  const dialog = page.getByRole('dialog', { name: '歇一小会儿', exact: true });
  if (!await dialog.isVisible()) return;
  expect(await dialog.textContent(), 'Only an observed browser stall may be recovered automatically').toContain('浏览器长时间停顿');
  const count = (recovered.get(page) ?? 0) + 1; recovered.set(page, count);
  expect(count, 'Repeated browser stalls are a failure, not a passing playthrough').toBeLessThanOrEqual(3);
  console.info('Observed browser stall; resumed through visible button: ' + count);
  await dialog.getByRole('button', { name: '继续游戏', exact: true }).click();
}
export async function waitKitchen(page: Page, predicate: (world: KitchenSnapshot) => boolean, timeout = 20000) {
  await expect.poll(async () => { await recoverStall(page); return predicate(await readKitchen(page)); }, { timeout, intervals: [80, 120, 200] }).toBe(true);
}
export async function startKitchen(page: Page, query = '', tutorial = false) {
  await page.goto('/' + (query ? '?' + query : ''));
  const start = page.getByRole('button', { name: tutorial ? '实操教学' : '开始游戏', exact: true });
  await expect(start).toBeEnabled({ timeout: 60000 });
  await start.click();
  if (!tutorial && await page.getByRole('button', { name: '跳过教学', exact: true }).isVisible()) await page.getByRole('button', { name: '跳过教学', exact: true }).click();
  await expect(page.getByRole('img', { name: '可操作的立体厨房', exact: true })).toHaveCount(1);
  await waitKitchen(page, w => w.tick > 2 && (tutorial ? w.phase === 'tutorial' : w.phase !== 'tutorial'));
}
const position = async (page: Page): Promise<Point> => { const p = (await readKitchen(page)).actors[0]; return { x: p.x, y: p.y }; };
/** Route planning observes the real map; movement is exclusively physical key presses. */
export async function walkKitchen(page: Page, target: Point, nearStation?: Point, replans = 0): Promise<void> {
  const world = await readKitchen(page), from = world.actors[0];
  const occupied = new Set(world.actors.slice(1).map(actor => `${Math.floor(actor.x)},${Math.floor(actor.y)}`));
  const {findPath,canStand}=createNavigation(getLevel(world.levelId));
  const route = findPath(from, target, occupied);
  expect(route.length, 'walkable route to ' + JSON.stringify(target)).toBeGreaterThan(0);
  route[route.length - 1] = target;
  const turns = route.filter((point, i) => {
    const previous = route[i - 1] ?? from, next = route[i + 1];
    return !next || Math.sign(point.x - previous.x) !== Math.sign(next.x - point.x) || Math.sign(point.y - previous.y) !== Math.sign(next.y - point.y);
  });
  for (const point of turns) for (const axis of ['x', 'y'] as const) {
    let reached = false, blocked = 0;
    for (let attempt = 0; attempt < 28; attempt++) {
      await recoverStall(page);
      const current = await position(page), delta = point[axis] - current[axis];
      if (Math.abs(delta) <= .12) { reached = true; break; }
      const key = axis === 'x' ? delta > 0 ? 'd' : 'a' : delta > 0 ? 's' : 'w';
      await page.keyboard.press(key, { delay: Math.min(550, Math.max(20, (Math.abs(delta) - .05) / 3.8 * 1000)) });
      await page.waitForTimeout(25);
      const next = await position(page);
      blocked = Math.abs(next[axis] - current[axis]) < .01 ? blocked + 1 : 0;
      // A chef may be standing at the centre of the port. A human can face the
      // counter from beside them; requiring the exact centre invents a blockage.
      if (blocked >= 3 && nearStation && Math.hypot(next.x - nearStation.x, next.y - nearStation.y) <= 1.2) return;
      if (blocked >= 3 && replans < 3) {
        const now = await readKitchen(page), otherAxis = axis === 'x' ? 'y' : 'x';
        const escape = [-1, 1].find(sign => [1, 2, 3, 4].every(step => {
          const p = { ...next, [otherAxis]: next[otherAxis] + sign * .18 * step };
          return canStand(p) && now.actors.slice(1).every(a => Math.hypot(a.x - p.x, a.y - p.y) >= .48);
        }));
        if (escape) await page.keyboard.press(otherAxis === 'x' ? escape > 0 ? 'd' : 'a' : escape > 0 ? 's' : 'w', { delay: 185 });
        return walkKitchen(page, target, nearStation, replans + 1);
      }
    }
    expect(reached, 'Physical movement to ' + JSON.stringify(point) + ' / ' + JSON.stringify(await position(page))).toBe(true);
  }
}
export async function goStation(page: Page, id: string) {
  const initial=await readKitchen(page),{canStand}=createNavigation(getLevel(initial.levelId));
  const station = initial.stations.find(s => s.id === id)!;
  expect(station, id).toBeTruthy();
  const port = center(station.ports[0]), target = center(station), world = await readKitchen(page);
  const nx = target.x - port.x, ny = target.y - port.y;
  const candidates = [port, ...[-.45, .45].map(offset => ({ x: port.x + ny * offset + nx * .14, y: port.y - nx * offset + ny * .14 }))];
  const approach = candidates.find(p => canStand(p) && world.actors.slice(1).every(a => Math.hypot(a.x - p.x, a.y - p.y) >= .54)) ?? port;
  await walkKitchen(page, approach, target);
  const point = await position(page), dx = target.x - point.x, dy = target.y - point.y;
  const horizontal = Math.abs(dx) > Math.abs(dy), direction = Math.sign(horizontal ? dx : dy);
  const key = horizontal ? direction > 0 ? 'd' : 'a' : direction > 0 ? 's' : 'w';
  await page.keyboard.down(key);
  try { await expect.poll(async () => { const facing = (await readKitchen(page)).actors[0].facing; return horizontal ? facing.x === direction && facing.y === 0 : facing.y === direction && facing.x === 0; }, { timeout: 2000, intervals: [20, 30] }).toBe(true); }
  finally { await page.keyboard.up(key); }
  await expect.poll(() => page.evaluate(() => window.__MCKITCHEN__!.preview()?.stationId), { timeout: 5000 }).toBe(id);
}
export async function interactKitchen(page: Page, id?: string) {
  if (id) await goStation(page, id);
  const before = await readKitchen(page);
  await page.keyboard.press('e');
  await waitKitchen(page, w => w.tick > before.tick + 1 || (w.phase !== before.phase && w.tick < before.tick));
}
export const held = (w: KitchenSnapshot) => w.items.find(i => i.id === w.actors[0].heldId);
export async function expectHeld(page: Page, kind: ItemKind) { await waitKitchen(page, w => held(w)?.kind === kind); }
export async function workKitchen(page: Page, stationId: string, output: ItemKind) {
  await goStation(page, stationId);
  await page.keyboard.down('Space');
  try { await waitKitchen(page, w => w.items.find(i => i.id === w.stations.find(s => s.id === stationId)?.itemId)?.kind === output, 15000); }
  finally { await page.keyboard.up('Space'); }
}
export async function prepareBurger(page: Page, cheese = false) {
  await interactKitchen(page, 'meat'); await expectHeld(page, 'rawPatty');
  await interactKitchen(page, 'grill-a');
  await interactKitchen(page, 'bun'); await interactKitchen(page, 'pass-s0');
  await waitKitchen(page, w => w.stations.find(s => s.id === 'grill-a')?.state === 'ready');
  await interactKitchen(page, 'grill-a'); await expectHeld(page, 'patty');
  await interactKitchen(page, 'pass-s0');
  if (cheese) { await interactKitchen(page, 'cheese'); await interactKitchen(page, 'pass-s0'); }
  await interactKitchen(page); await expectHeld(page, cheese ? 'cheeseburger' : 'burger');
}
export async function prepareFried(page: Page, chicken = false) {
  await interactKitchen(page, chicken ? 'chicken' : 'potato'); await interactKitchen(page, 'chop-a');
  await workKitchen(page, 'chop-a', chicken ? 'cutChicken' : 'cutPotato');
  await interactKitchen(page); await interactKitchen(page, 'fryer-a');
  await waitKitchen(page, w => w.stations.find(s => s.id === 'fryer-a')?.state === 'ready');
  await interactKitchen(page, 'fryer-a'); await expectHeld(page, chicken ? 'nuggets' : 'fries');
}
export async function prepareCola(page: Page) {
  await interactKitchen(page, 'cups'); await expectHeld(page, 'cup'); await interactKitchen(page, 'drink');
  await workKitchen(page, 'drink', 'cola'); await interactKitchen(page); await expectHeld(page, 'cola');
}
export async function serveKitchen(page: Page, orderId: string) {
  await interactKitchen(page, 'serve-a');
  await waitKitchen(page, w => w.orders.find(o => o.id === orderId)?.status === 'served');
}
