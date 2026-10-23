import { test, expect } from '@playwright/test';
import { interactKitchen, readKitchen, startKitchen, waitKitchen } from './kitchen-helpers';

test('缺失模型保持可恢复错误，重载后只有一个厨房和一套输入', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  const broken = '**/assets/original/models/counter.glb';
  await page.route(broken, route => route.fulfill({ status: 503, body: 'Deliberate local fixture: missing counter' }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('模型加载失败');
  // Let the other parallel loads finish. They must not erase the failed state.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeDisabled();
  expect((await readKitchen(page)).tick).toBe(0);
  await page.unroute(broken);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeEnabled({ timeout: 60000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-testid="kitchen"] canvas')).toHaveCount(1);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  if (await page.getByRole('button', { name: '跳过教学', exact: true }).isVisible()) await page.getByRole('button', { name: '跳过教学', exact: true }).click();
  await waitKitchen(page, w => w.tick > 2 && w.phase !== 'tutorial');
  const before = (await readKitchen(page)).actors[0];
  await page.keyboard.press('d', { delay: 180 });
  const after = (await readKitchen(page)).actors[0];
  expect(after.x - before.x).toBeGreaterThan(.4); expect(after.x - before.x).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('暂停取消蓄力；重试和返回标题可再次开始', async ({ page }) => {
  await startKitchen(page, 'ai=false&prepSeconds=0&serviceSeconds=900');
  await interactKitchen(page, 'meat');
  const itemId = (await readKitchen(page)).actors[0].heldId;
  await page.keyboard.down('f'); await page.waitForTimeout(220);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__MCKITCHEN__!.paused())).toBe(true);
  const tick = (await readKitchen(page)).tick; await page.waitForTimeout(250); expect((await readKitchen(page)).tick).toBe(tick);
  await page.keyboard.up('f');
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  await waitKitchen(page, w => w.tick > tick + 3);
  let world = await readKitchen(page);
  expect(world.actors[0].heldId).toBe(itemId); expect(world.items.find(i => i.id === itemId)?.location.type).toBe('hand');
  expect(world.events.some(e => e.type === 'throw')).toBe(false);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '同关重试', exact: true }).click();
  world = await readKitchen(page); expect(world.actors[0].heldId).toBeNull(); expect(world.metrics.served).toBe(0); expect(world.tick).toBeLessThan(120);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '返回标题', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'McRush 麦门厨房' })).toBeVisible();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('[data-testid="kitchen"] canvas')).toHaveCount(1);
  await waitKitchen(page, w => w.tick > 3);
  await page.screenshot({ path: 'output/playwright/kitchen-restarted.png' });
});
