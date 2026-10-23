import {challengeFixture} from './kitchen-challenge-fixture';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { interactKitchen,prepareCola,readKitchen,startKitchen,waitKitchen,walkKitchen } from './kitchen-helpers';

test.use({ viewport:{width:1600,height:900} });
for(const level of ['lunch-line','night-relay'] as const) test(level+': 实际新机制教学、自然计时完整营业与保存',async({page})=>{
  test.setTimeout(600000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  const start=Date.now();
  await startKitchen(page,'level='+level,true);
  expect((await readKitchen(page)).levelId).toBe(level);
  if(level==='lunch-line') {
    await prepareCola(page);await interactKitchen(page,'pass-n0');
    await waitKitchen(page,w=>!!w.stations.find(s=>s.id==='pass-n3')?.itemId,20000);
    await interactKitchen(page,'pass-n3');await interactKitchen(page,'serve-a');
  }else{
    await prepareCola(page);
    await interactKitchen(page,'serve-b');
    expect((await readKitchen(page)).actors[0].heldId).not.toBeNull();
    expect((await readKitchen(page)).metrics.served).toBe(0);
    await expect(page.getByTestId('guide')).toContainText('堂食');
    await interactKitchen(page,'serve-a');
    await prepareCola(page);await interactKitchen(page,'serve-b');
  }
  await waitKitchen(page,w=>w.phase==='prep');
  const serviceStart=Date.now();
  expect((await readKitchen(page)).phaseRemaining).toBeLessThanOrEqual(20*60);
  for(const station of ['pass-s0','pass-s1','pass-s2']) {await prepareCola(page);await interactKitchen(page,station);}
  await page.keyboard.press('q');await page.keyboard.press('2');await page.keyboard.press('t');
  await waitKitchen(page,w=>!!w.actors[2].assist);
  await page.keyboard.press('q');
  await walkKitchen(page,{x:4.5,y:8.5});
  await waitKitchen(page,w=>w.serviceTick>=100*60,160000);
  await page.screenshot({path:`output/playwright/${level}-natural-rush.png`});
  await waitKitchen(page,w=>w.phase==='results',220000);
  const world=await readKitchen(page);
  expect(world.serviceTick).toBeGreaterThanOrEqual(240*60);
  expect(Date.now()-serviceStart).toBeGreaterThan(239000);
  expect(world.metrics.served).toBeGreaterThanOrEqual(Math.ceil(world.orders.length*.5));
  expect(world.metrics.mistakes).toBe(0);
  expect(world.metrics.contributions.player).toBeGreaterThan(0);
  expect(world.actors.slice(1).every(a=>a.completedActions>10)).toBe(true);
  await expect(page.getByRole('dialog',{name:'这一班，辛苦了！'})).toBeVisible();
  await page.screenshot({path:`output/playwright/${level}-results.png`});
  const evidence={source:'Headed Chromium, real keyboard and visible controls, natural fixed-step clock, no injected commands or state',elapsedSeconds:(Date.now()-start)/1000,serviceElapsedSeconds:(Date.now()-serviceStart)/1000,metrics:world.metrics,rating:world.shiftRating,mechanicProgress:world.mechanicProgress,performance:await page.evaluate(()=>window.__MCKITCHEN__!.performance()),commands:await page.evaluate(()=>window.__MCKITCHEN__!.commandLog()),errors};
  await writeFile(`output/playwright/${level}-fullgame-evidence.json`,JSON.stringify(evidence,null,2));
  console.info(JSON.stringify({...evidence,commands:evidence.commands.length}));
  await page.getByRole('button',{name:'关卡选择',exact:true}).click();
  await expect(page.getByRole('button',{name:new RegExp('选择关卡 '+(level==='lunch-line'?2:3))})).toContainText('★');
  await page.reload();
  const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('mcrush-scores-')));
  expect(saved.some(([,v])=>v.includes(level))).toBe(true);
  expect(errors).toEqual([]);
});

test('三关选择、挑战预览与非法导入保护、画质和焦点暂停',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('/');
  for(const [i,level]of ['first-shift','lunch-line','night-relay'].entries()){
    await page.getByRole('button',{name:new RegExp('选择关卡 '+(i+1))}).click();
    await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled({timeout:60000});
    expect((await readKitchen(page)).levelId).toBe(level);
    await page.screenshot({path:`output/playwright/${level}-title.png`});
  }
  await page.getByRole('button',{name:'导入活动挑战',exact:true}).click();
  await page.getByLabel('挑战文件').setInputFiles(await challengeFixture());
  await expect(page.getByRole('button',{name:'采用这个挑战'})).toBeVisible();
  await page.getByRole('button',{name:'采用这个挑战'}).click();
  await expect(page.locator('.active-challenge')).toBeVisible();
  const level=(await readKitchen(page)).levelId;
  await page.getByRole('button',{name:'导入活动挑战',exact:true}).click();
  await page.getByLabel('挑战文件').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"token":"must-not-enter-game"}')});
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await readKitchen(page)).levelId).toBe(level);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.locator('.active-challenge')).toBeVisible();
  await page.getByRole('button',{name:'画面与声音',exact:true}).click();
  await page.getByRole('button',{name:'性能',exact:true}).click();
  await page.getByRole('checkbox',{name:'减少强烈动效与蒸汽'}).check();
  await page.getByRole('button',{name:'回到厨房',exact:true}).click();
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  if(await page.getByRole('button',{name:'跳过教学'}).isVisible())await page.getByRole('button',{name:'跳过教学'}).click();
  await waitKitchen(page,w=>w.tick>3);
  const tick=(await readKitchen(page)).tick;
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('dialog',{name:'歇一小会儿'})).toBeVisible();
  const pause=(await readKitchen(page)).tick;
  await page.waitForTimeout(350);expect((await readKitchen(page)).tick).toBe(pause);expect(pause).toBeGreaterThanOrEqual(tick);
  await page.getByRole('button',{name:'均衡',exact:true}).click();
  await page.getByRole('button',{name:'继续游戏',exact:true}).click();
  await waitKitchen(page,w=>w.tick>pause+20);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'返回标题',exact:true}).click();await page.reload();
  expect((await readKitchen(page)).levelId).toBe('first-shift');
  await page.getByRole('button',{name:'导入活动挑战',exact:true}).click();
  await expect(page.getByRole('button',{name:'采用这个挑战'})).toBeVisible();
  await expect(page.getByText('有效至',{exact:true})).toBeVisible();
  expect((await readKitchen(page)).levelId).toBe('first-shift'); // Stored preview never auto-activates.
  await page.getByLabel('挑战文件').setInputFiles({name:'invalid-replacement.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'采用这个挑战'})).toHaveCount(0);
  expect(errors).toEqual([]);
});
