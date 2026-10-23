import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectHeld, goStation, held, interactKitchen, prepareBurger, prepareCola, readKitchen, startKitchen, waitKitchen, walkKitchen, workKitchen } from './kitchen-helpers';
import type { Dish } from '../src/kitchen/types';

test.use({ viewport: { width: 1600, height: 900 } });
test('第一关：真实三段教学、主动指挥、自然完整回合与成绩重试', async ({ page }) => {
  test.setTimeout(660000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  const started = Date.now();
  await startKitchen(page, '', true);
  await expect(page.getByTestId('clock')).toHaveText('∞');
  await prepareBurger(page); await interactKitchen(page, 'serve-a');
  await waitKitchen(page, w => w.tutorial?.stage === 'handoff');
  await interactKitchen(page, 'potato'); await interactKitchen(page, 'chop-a');
  await workKitchen(page, 'chop-a', 'cutPotato'); await interactKitchen(page);
  await interactKitchen(page, 'pass-n0');
  await page.keyboard.press('q');await page.keyboard.press('1');await page.keyboard.press('e');
  await waitKitchen(page,w=>!!w.actors[1].assist);await page.keyboard.press('q');
  await walkKitchen(page, { x: 4.5, y: 7.5 });
  await waitKitchen(page, w => w.tutorial?.stage === 'combo', 60000);
  await page.screenshot({ path: 'output/playwright/kitchen-tutorial-handoff.png' });
  // Player really fills the tray; the tutorial's AI may only prepare the hot dishes.
  await interactKitchen(page, 'trays'); await interactKitchen(page, 'assembly-a');
  await prepareCola(page); await interactKitchen(page, 'assembly-a');
  for (const kind of ['burger', 'fries'] as Dish[]) {
    await waitKitchen(page, w => w.items.some(i => i.kind === kind && i.location.type === 'station'), 60000);
    const food = (await readKitchen(page)).items.find(i => i.kind === kind && i.location.type === 'station')!;
    if (food.location.type !== 'station') throw new Error('Tutorial food must be physically accessible');
    await interactKitchen(page, food.location.stationId); await expectHeld(page, kind); await interactKitchen(page, 'assembly-a');
  }
  const teaching = await readKitchen(page);
  expect(teaching.tutorial?.stage).toBe('combo');
  expect(teaching.items.find(i => i.kind === 'tray')?.contents).toHaveLength(3);
  await page.screenshot({ path: 'output/playwright/kitchen-tutorial-packed-by-player.png' });
  await interactKitchen(page); await expectHeld(page, 'tray'); await interactKitchen(page, 'serve-a');
  await waitKitchen(page, w => w.phase === 'prep');
  let world = await readKitchen(page);
  expect(world.metrics.served).toBe(0); expect(world.orders).toHaveLength(10); expect(world.items).toHaveLength(0);
  expect(world.phaseRemaining).toBeLessThanOrEqual(20 * 60);
  const serviceStart = Date.now();
  // A useful human role: prepare shared drinks while the two chefs handle hot food.
  for (const counter of ['pass-s0', 'pass-s1', 'pass-s2']) { await prepareCola(page); await interactKitchen(page, counter); }
  await page.keyboard.press('q');
  await page.getByLabel('Mika 长期岗位').selectOption('auto');
  await waitKitchen(page, w => w.actors[1].role === 'auto');
  await page.getByLabel('Mika 长期岗位').selectOption('hot');
  await waitKitchen(page, w => w.actors[1].role === 'hot');
  await page.getByRole('button', { name: /T 优先完成这单/ }).click();
  await waitKitchen(page, w => !!w.actors[1].assist);
  await page.screenshot({path:'output/playwright/kitchen-quick-command.png'});
  await page.getByRole('button', { name: /回到厨房/ }).click();
  await walkKitchen(page, { x: 4.5, y: 8.5 });
  await waitKitchen(page, w => w.serviceTick >= 140 * 60, 170000);
  world = await readKitchen(page);
  expect(world.metrics.handoffs).toBeGreaterThan(0);
  expect(world.metrics.contributions.player).toBeGreaterThan(0);
  await page.screenshot({ path: 'output/playwright/kitchen-natural-rush.png' });
  await waitKitchen(page, w => w.phase === 'results', 190000);
  const final = await readKitchen(page);
  expect(final.serviceTick).toBeGreaterThanOrEqual(180 * 60);
  expect(Date.now() - serviceStart).toBeGreaterThan(179000);
  expect(final.metrics.served).toBeGreaterThanOrEqual(8);
  expect(final.metrics.served + final.metrics.missed).toBe(10);
  expect(final.metrics.mistakes).toBe(0);
  expect(final.actors[1].completedActions).toBeGreaterThan(10); expect(final.actors[2].completedActions).toBeGreaterThan(10);
  await expect(page.getByRole('dialog', { name: '这一班，辛苦了！' })).toBeVisible();
  await expect(page.getByLabel('错餐与工序贡献')).toContainText('错餐 0 次');
  await page.screenshot({ path: 'output/playwright/kitchen-fullgame-results.png' });
  const evidence = { source: 'Real browser keyboard, real AI movements, natural 60 Hz clock; no fast-forward or state injection', elapsedSeconds: (Date.now() - started) / 1000, serviceElapsedSeconds: (Date.now() - serviceStart) / 1000, metrics: final.metrics, orders: final.orders, events: final.events, performance: await page.evaluate(() => window.__MCKITCHEN__!.performance()), commands: await page.evaluate(() => window.__MCKITCHEN__!.commandLog()), errors };
  await writeFile('output/playwright/first-shift-fullgame-evidence.json', JSON.stringify(evidence, null, 2));
  console.info(JSON.stringify({ ...evidence, commands: evidence.commands.length, events: evidence.events.length, orders: final.orders.map(o => ({ id: o.id, status: o.status, seconds: o.servedAt === null ? null : o.servedAt / 60 })) }));
  await page.getByRole('button', { name: '同关重试', exact: true }).click();
  await waitKitchen(page, w => w.phase === 'prep' && w.tick > 2);
  world = await readKitchen(page); expect(world.metrics.served).toBe(0); expect(held(world)).toBeUndefined(); expect(world.actors[0].completedActions).toBe(0);
  expect(errors).toEqual([]);
});
