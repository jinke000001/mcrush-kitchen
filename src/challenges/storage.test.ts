import {afterEach,expect,it,vi} from 'vitest';
import {loadSavedChallenge,saveChallenge} from './storage';
import {RULES_VERSION} from '../kitchen/types';
import type {ChallengeSpec} from './index';
afterEach(()=>vi.unstubAllGlobals());
const fixture=():ChallengeSpec=>({schemaVersion:'mcrush-challenge-1',rulesVersion:RULES_VERSION,title:'薯香接力',levelId:'lunch-line',seed:42,template:'fryer-rush',createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),source:{provider:'mcd-campaign-calendar',fetchedAt:new Date(Date.now()-2000).toISOString(),articles:[{title:'薯类活动',url:null}]}});
it('keeps a validated versioned challenge and rejects an invalid replacement',()=>{
  const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});
  expect(saveChallenge(fixture())).toBe(true);expect(loadSavedChallenge()?.spec.seed).toBe(42);
  expect(saveChallenge({...fixture(),seed:-1})).toBe(false);expect(loadSavedChallenge()?.spec.seed).toBe(42);
  const text=data.get('mcrush-last-challenge-'+RULES_VERSION)!;
  expect(Object.keys(JSON.parse(text))).not.toContain('token');
});
it('ignores expired, corrupt, old or unavailable storage without changing other data',()=>{
  const saved=fixture();saved.expiresAt=new Date(Date.now()-500).toISOString();
  for(const text of [JSON.stringify(saved),'broken',JSON.stringify({...fixture(),rulesVersion:'old'})]){
    const setItem=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>text,setItem});expect(loadSavedChallenge()).toBeNull();expect(setItem).not.toHaveBeenCalled();
  }
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  expect(loadSavedChallenge()).toBeNull();expect(saveChallenge(fixture())).toBe(false);
});
