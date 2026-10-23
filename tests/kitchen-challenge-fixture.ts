import {readFile} from 'node:fs/promises';
import {parseChallenge,type ChallengeSpec} from '../src/challenges';

/** Historical live evidence stays unchanged. After expiry, tests use clearly labelled fiction. */
export async function challengeFixture(){
  const historical=await readFile('public/challenges/fryer-rush-2026-10-23.json');
  if(parseChallenge(historical.toString()).ok)return {name:'fryer-rush-2026-10-23.json',mimeType:'application/json',buffer:historical,provenance:'Unchanged real-query snapshot from 2026-10-23'};
  const now=Date.now(),spec:ChallengeSpec={...JSON.parse(historical.toString()),title:'自动化虚构测试 · 炸物高峰',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),source:{provider:'mcd-campaign-calendar',fetchedAt:new Date(now).toISOString(),articles:[{title:'自动化虚构数据，不是真实活动',url:null}]}};
  return {name:'synthetic-test-challenge.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(spec)),provenance:'Synthetic automated test fixture, not a new MCP query or fresh activity evidence'};
}
