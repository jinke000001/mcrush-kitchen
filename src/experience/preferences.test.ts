import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitchenEngine } from '../kitchen/engine';
import { loadPreferences,loadScores,recordShift } from './preferences';
import { RULES_VERSION } from '../kitchen/types';
afterEach(()=>vi.unstubAllGlobals());
function storage(initial:Record<string,string>={}){const data=new Map(Object.entries(initial));vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});return data;}
describe('versioned optional player progress',()=>{
  it('ignores old rules and malformed records without deleting them',()=>{const data=storage({'mcrush-best':'private-old-score',['mcrush-scores-'+RULES_VERSION]:JSON.stringify({'first-shift':{stars:99,score:5,seed:1,served:1,onTime:1}})});expect(loadScores()).toEqual({});expect(data.get('mcrush-best')).toBe('private-old-score');});
  it('stores independent per-level bests only after results',()=>{storage();const engine=new KitchenEngine({tutorial:false,prepSeconds:0,serviceSeconds:1,closingSeconds:0});expect(recordShift(engine.getSnapshot())).toBe(false);for(let i=0;i<61;i++)engine.step();expect(recordShift(engine.getSnapshot())).toBe(true);expect(loadScores()['first-shift']).toMatchObject({stars:0,seed:1024});expect(loadScores()['night-relay']).toBeUndefined();});
  it('keeps play available when storage is blocked',()=>{vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});expect(loadScores()).toEqual({});expect(loadPreferences().quality).toBe('balanced');});
});
