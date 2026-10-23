import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../game/audio',()=>({audio:{unlock:vi.fn(),start:vi.fn(),stop:vi.fn(),pause:vi.fn(),sound:vi.fn(),setPhase:vi.fn()}}));
import { KitchenSession } from './session';

afterEach(()=>vi.unstubAllGlobals());
function sessionClock() {
  let frame:FrameRequestCallback=()=>{};
  vi.stubGlobal('window',new EventTarget());
  vi.stubGlobal('document',new EventTarget());
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frame=callback;return 1;});
  vi.stubGlobal('cancelAnimationFrame',()=>{});
  const session=new KitchenSession({tutorial:false});
  session.attachRenderer(()=>{});session.setReady();session.begin(false);session.start();frame(0);
  let now=0;
  return {session,advance:(ms=20)=>frame(now+=ms)};
}
it('closing the command panel in the same frame preserves an accepted assist',()=>{
  const {session,advance}=sessionClock();
  session.setPanel('command');
  session.assist({type:'station',id:'grill-a'});
  session.setPanel('none');advance();
  expect(session.commandLog().filter(x=>x.command.type==='assist')).toHaveLength(1);
  expect(session.engine.readSnapshot().actors[1].assist?.target).toEqual({type:'station',id:'grill-a'});
  session.stop();
});
it('pausing cancels pending inputs and does not move the simulation clock',()=>{
  const {session,advance}=sessionClock();
  session.command({type:'move',x:1,y:0});session.assist({type:'station',id:'grill-a'});
  session.pause();advance();expect(session.engine.readSnapshot().tick).toBe(0);
  session.resume();advance();advance();
  expect(session.engine.readSnapshot().tick).toBeGreaterThan(0);
  expect(session.commandLog().some(x=>x.command.type==='assist')).toBe(false);
  session.stop();
});
it('visual quality cannot change rules or the fixed-step clock',()=>{
  const states=[];
  for(const quality of ['high','balanced','performance'] as const){
    const {session,advance}=sessionClock();session.setPreferences({quality});
    for(let i=0;i<500;i++)advance();
    states.push(session.engine.getSnapshot());session.stop();
  }
  expect(states[1]).toEqual(states[0]);expect(states[2]).toEqual(states[0]);
});
it('counts a long foreground stall in the full-round histogram before pausing',()=>{
  const {session,advance}=sessionClock();advance(2500);
  expect(session.diagnostics()).toMatchObject({stalls:1,max:2500,samples:2,elapsedSeconds:2.5});
  expect(session.getView().paused).toBe(true);expect(session.engine.readSnapshot().tick).toBe(0);
  session.stop();
});
