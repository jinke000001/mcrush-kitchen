import { useRef, useState } from 'react';
import { MAX_CHALLENGE_BYTES, parseChallenge, type ChallengeResult } from '../challenges';
import {loadSavedChallenge} from '../challenges/storage';
import type { KitchenSession } from './session';
export function ChallengeImport({session,close}:{session:KitchenSession;close:()=>void}) {
  const [result,setResult]=useState<ChallengeResult|null>(loadSavedChallenge),[error,setError]=useState('');
  const loadEpoch=useRef(0);
  const load=async(file:File|undefined)=>{
    if(!file)return;
    const epoch=++loadEpoch.current;setResult(null);setError('');
    if(file.size>MAX_CHALLENGE_BYTES){setError('文件不能超过 32 KB。已选挑战保持不变。');return;}
    try {const next=parseChallenge(await file.text());if(epoch!==loadEpoch.current)return;if(!next.ok){setError(next.error.message);return;}setResult(next);setError('');}catch{if(epoch===loadEpoch.current)setError('无法读取这个文件，请重新选择。');}
  };
  const apply=()=>{if(!result?.ok)return;const problem=session.importChallenge(result.spec);if(problem)setError(problem);else close();};
  return <div className="challenge-import"><p className="dialog-lede">在 MCP 客户端主动查询活动，用项目 Skill 生成挑战文件，然后放进这里。普通三关始终可以直接玩。</p><label className="file-drop"><span>选择挑战 JSON 文件</span><input aria-label="挑战文件" type="file" accept=".json,application/json" onChange={event=>void load(event.target.files?.[0])}/><small>最多 32 KB · 有效的上次挑战会保留在预览中</small></label>{error&&<p className="import-error" role="alert">{error}</p>}
    {result?.ok&&<article className="challenge-preview"><span className="eyebrow">活动主题 / 游戏虚构挑战</span><h3>{result.preview.title}</h3><dl><div><dt>关卡</dt><dd>{result.preview.levelName}</dd></div><div><dt>主题</dt><dd>{result.preview.templateName} · {result.preview.orderCount} 单</dd></div><div><dt>种子</dt><dd>{result.spec.seed}</dd></div><div><dt>获取时间</dt><dd>{new Date(result.preview.fetchedAt).toLocaleString('zh-CN')}</dd></div><div><dt>有效至</dt><dd>{new Date(result.preview.expiresAt).toLocaleString('zh-CN')}</dd></div></dl><p className="source-title">活动依据：{result.preview.sourceTitles.join('；')}</p><p>{result.preview.disclaimer}</p><button className="button-primary" onClick={apply}>采用这个挑战</button></article>}
    <p className="setting-note">活动不等于完整菜单或真实工序。挑战仅调整现有餐品配比；独立于普通关卡最佳成绩。游戏不读取或保存 Token。</p>
  </div>;
}
