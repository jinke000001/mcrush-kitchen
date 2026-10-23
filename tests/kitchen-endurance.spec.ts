import {challengeFixture} from './kitchen-challenge-fixture';
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { KitchenScene3D } from '../src/experience/scene3d';
import { readKitchen, waitKitchen } from './kitchen-helpers';

test.use({viewport:{width:1600,height:900}});
test('本机 Chrome：冷启动网络预算、连续20分钟、重开10次',async({page,context,browser})=>{
  test.setTimeout(1900000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:20_000_000/8,uploadThroughput:20_000_000/8});
  const start=Date.now();await page.goto('/?level=night-relay');
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled({timeout:30000});
  const coldStartMs=Date.now()-start;
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
  const environment=await page.evaluate(()=>({userAgent:navigator.userAgent,devicePixelRatio,viewport:[innerWidth,innerHeight],hardwareConcurrency:navigator.hardwareConcurrency}));
  const challenge=await challengeFixture();
  await page.getByRole('button',{name:'导入活动挑战',exact:true}).click();
  await page.getByLabel('挑战文件').setInputFiles(challenge);
  await page.getByRole('button',{name:'采用这个挑战'}).click();
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  if(await page.getByRole('button',{name:'跳过教学',exact:true}).isVisible())await page.getByRole('button',{name:'跳过教学',exact:true}).click();
  const rounds:unknown[]=[],restarts:unknown[]=[];
  const samples:{geometries:number;textures:number;programs:number;heap:number;nodes:number;listeners:number}[]=[];
  const sustainedStart=Date.now();let activeSeconds=0;
  async function resources(){
    // Collection is outside measured gameplay, at results or after the restart sample.
    await cdp.send('HeapProfiler.collectGarbage');
    const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
    const performance=await page.evaluate(()=>window.__MCKITCHEN__!.performance());
    return {...performance.rendering as ReturnType<KitchenScene3D['diagnostics']>,heap:heap.usedSize,nodes:dom.nodes,listeners:dom.jsEventListeners};
  }
  async function save(){await mkdir('output/playwright',{recursive:true});await writeFile('output/playwright/native-chrome-endurance.json',JSON.stringify({source:'Installed Google Chrome; headed, 1600×900 balanced; natural 60Hz simulation; no fast-forward. GC only at results and restart resource snapshots.',browser:browser.version(),environment,challenge:{file:challenge.name,provenance:challenge.provenance},coldStartMs,network:{downloadMbps:20,latencyMs:100,cache:false},elapsedSeconds:(Date.now()-sustainedStart)/1000,activeSeconds,rounds,restarts,errors},null,2));}
  while(activeSeconds<1200){
    await waitKitchen(page,w=>w.phase==='results',330000);
    const world=await readKitchen(page),performance=await page.evaluate(()=>window.__MCKITCHEN__!.performance());
    activeSeconds+=performance.elapsedSeconds;
    const sample=await resources();samples.push(sample);
    rounds.push({levelId:world.levelId,metrics:world.metrics,rating:world.shiftRating,performance,resources:sample});
    await save();console.info('Completed natural endurance round '+rounds.length+'; active '+Math.round(activeSeconds)+'s');
    if(activeSeconds<1200){await page.getByRole('button',{name:'同关重试',exact:true}).click();await waitKitchen(page,w=>w.phase==='prep'&&w.tick>3);}
  }
  for(let i=0;i<10;i++){
    if((await readKitchen(page)).phase!=='results')await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.getByRole('button',{name:'同关重试',exact:true}).click();await waitKitchen(page,w=>w.phase==='prep'&&w.tick>=60);
    // A single physical key press must yield exactly one action after every restart.
    const before=(await page.evaluate(()=>window.__MCKITCHEN__!.commandLog())).filter(x=>x.command.type==='interact').length;
    await page.keyboard.press('e');await waitKitchen(page,w=>w.tick>=75);
    expect((await page.evaluate(()=>window.__MCKITCHEN__!.commandLog())).filter(x=>x.command.type==='interact')).toHaveLength(before+1);
    await page.keyboard.press('q');await expect(page.getByRole('complementary',{name:'一起分工'})).toBeVisible();
    await page.keyboard.press('q');await expect(page.getByRole('complementary',{name:'一起分工'})).toHaveCount(0);
    const sample=await resources();restarts.push(sample);samples.push(sample);await save();
  }
  const restartSamples=samples.slice(-10),first=restartSamples[0],last=restartSamples.at(-1)!;
  expect(last.geometries).toBe(first.geometries);expect(last.textures).toBe(first.textures);expect(last.programs).toBe(first.programs);
  expect(last.listeners).toBeLessThanOrEqual(first.listeners);expect(last.nodes).toBeLessThanOrEqual(first.nodes+5);
  expect(last.heap-first.heap,'Post-GC restart heap growth must remain below 2 MiB').toBeLessThan(2*1024*1024);
  expect(errors).toEqual([]);expect(coldStartMs).toBeLessThanOrEqual(8000);
  for(const round of rounds as {performance:{p95:number;p99:number;stalls:number}}[]){expect(round.performance.p95).toBeLessThanOrEqual(20);expect(round.performance.p99).toBeLessThanOrEqual(33.3);expect(round.performance.stalls).toBe(0);}
});


test('本机 Chrome：第一关完整回合性能复验',async({page,context,browser})=>{
  test.setTimeout(300000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:20_000_000/8,uploadThroughput:20_000_000/8});
  const start=Date.now();await page.goto('/?level=first-shift');
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled({timeout:30000});
  const coldStartMs=Date.now()-start;
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  if(await page.getByRole('button',{name:'跳过教学',exact:true}).isVisible())await page.getByRole('button',{name:'跳过教学',exact:true}).click();
  await waitKitchen(page,w=>w.phase==='results',270000);
  const world=await readKitchen(page),performance=await page.evaluate(()=>window.__MCKITCHEN__!.performance());
  await writeFile('output/playwright/native-chrome-first-shift.json',JSON.stringify({source:'Installed headed Google Chrome, passive player, 1600×900 balanced, whole normal-time round; includes all foreground intervals including stalls. No video or concurrent build.',browser:browser.version(),coldStartMs,network:{downloadMbps:20,latencyMs:100,cache:false},levelId:world.levelId,metrics:world.metrics,performance,errors},null,2));
  expect(coldStartMs).toBeLessThanOrEqual(8000);expect(errors).toEqual([]);
  expect(performance.p95).toBeLessThanOrEqual(20);expect(performance.p99).toBeLessThanOrEqual(33.3);expect(performance.stalls).toBe(0);
});
