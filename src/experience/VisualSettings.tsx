import type { KitchenSession } from './session';
import type { Quality } from './preferences';
export function VisualSettings({session}:{session:KitchenSession}) {
  const p=session.getView().preferences;
  return <fieldset className="visual-settings"><legend>画面与动效</legend><div className="quality-options" role="group" aria-label="画质">{([['high','精致'],['balanced','均衡'],['performance','性能']]as[Quality,string][]).map(([id,name])=><button key={id} aria-pressed={p.quality===id} onClick={()=>session.setPreferences({quality:id})}>{name}</button>)}</div><p>只改变画面，订单和计时保持一致。</p><label><input type="checkbox" checked={p.reducedEffects} onChange={e=>session.setPreferences({reducedEffects:e.target.checked})}/> 减少强烈动效与蒸汽</label><label><input type="checkbox" checked={p.labels} onChange={e=>session.setPreferences({labels:e.target.checked})}/> 显示工位名称</label></fieldset>;
}
