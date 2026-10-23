import { RULES_VERSION } from '../kitchen/types';
import { parseChallenge, type ChallengeResult, type ChallengeSpec } from './index';
const KEY='mcrush-last-challenge-'+RULES_VERSION;

/** Optional, versioned last-used file. Reading never activates a challenge. */
export function loadSavedChallenge():Extract<ChallengeResult,{ok:true}>|null {
  try {const text=localStorage.getItem(KEY);if(!text)return null;const result=parseChallenge(text);return result.ok?result:null;}catch{return null;}
}
export function saveChallenge(spec:ChallengeSpec):boolean {
  try {const result=parseChallenge(JSON.stringify(spec));if(!result.ok)return false;localStorage.setItem(KEY,JSON.stringify(result.spec));return true;}catch{return false;}
}
