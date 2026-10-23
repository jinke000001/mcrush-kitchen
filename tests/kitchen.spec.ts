import { test, expect } from '@playwright/test';
import { expectHeld, held, interactKitchen, prepareBurger, prepareCola, prepareFried, readKitchen, serveKitchen, startKitchen, waitKitchen } from './kitchen-helpers';

test('真实键盘完成五种餐品、三件套餐、错餐恢复与暂停', async ({ page }) => {
  test.setTimeout(480000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  await startKitchen(page, 'scenario=manual');
  await page.screenshot({ path: 'output/playwright/kitchen-ready-1280.png' });
  // Raw food is rejected without deleting it or falsely completing an order.
  await interactKitchen(page, 'meat'); const rawId = held(await readKitchen(page))!.id;
  await interactKitchen(page, 'serve-a');
  let w = await readKitchen(page); expect(held(w)?.id).toBe(rawId); expect(w.metrics.served).toBe(0); expect(w.metrics.mistakes).toBe(1);
  await interactKitchen(page, 'bin'); await waitKitchen(page, state => !held(state));
  await prepareBurger(page); await serveKitchen(page, '01');
  await prepareBurger(page, true); await serveKitchen(page, '02');
  await prepareFried(page); await serveKitchen(page, '03');
  await prepareFried(page, true); await serveKitchen(page, '04');
  await prepareCola(page); await serveKitchen(page, '05');
  // One public tray genuinely contains three independently prepared dishes.
  await interactKitchen(page, 'trays'); await interactKitchen(page, 'assembly-a');
  await prepareBurger(page); await interactKitchen(page, 'assembly-a');
  await prepareFried(page); await interactKitchen(page, 'assembly-a');
  await prepareCola(page); await interactKitchen(page, 'assembly-a');
  const before = await readKitchen(page), tray = before.items.find(i => i.kind === 'tray')!;
  expect(tray.contents).toHaveLength(3);
  await page.screenshot({ path: 'output/playwright/kitchen-three-part-combo.png' });
  await interactKitchen(page); await expectHeld(page, 'tray'); await serveKitchen(page, '06');
  w = await readKitchen(page); expect(w.metrics.served).toBe(6); expect(w.actors[0].deliveries).toBe(6);
  await page.keyboard.press('Escape');
  const pausedTick = (await readKitchen(page)).tick; await page.waitForTimeout(300);
  expect((await readKitchen(page)).tick).toBe(pausedTick);
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  await waitKitchen(page, state => state.tick > pausedTick + 3);
  expect(errors).toEqual([]);
  console.info(JSON.stringify({ metrics: w.metrics, performance: await page.evaluate(() => window.__MCKITCHEN__!.performance()) }));
});
