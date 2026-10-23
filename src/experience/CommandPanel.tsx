import { ITEM_NAMES, ROLE_NAMES } from '../kitchen/recipes';
import type { Role } from '../kitchen/types';
import type { KitchenSession } from './session';
const STATUS={received:'已收到',waiting:'等待交接点',executing:'正在执行',completed:'已完成',cancelled:'已取消',failed:'需要重新选择'};
const ROLES:Record<Role,string>={auto:'哪里需要就补哪里',hot:'切配、煎肉、炸物',assembly:'组装、配盒、送餐',drinks:'接满可乐并补货'};
export function CommandPanel({session}:{session:KitchenSession}) {
  const view=session.getView(),w=view.game,selected=w.actors.find(a=>a.id===view.commandActor)!;
  const preview=session.engine.getInteractionPreview();
  const item=w.items.find(i=>i.id===(w.actors[0].heldId??preview?.itemId));
  const station=w.stations.find(s=>s.id===preview?.stationId);
  const order=w.orders.find(o=>o.id===w.priorityOrderId)??w.orders.find(o=>o.status==='active'||o.status==='late');
  return <aside className="quick-command" aria-label="一起分工">
    <div className="quick-heading"><div><span className="eyebrow">下一步，一起接住</span><h2>伙伴指挥</h2></div><button onClick={session.resume} aria-label="关闭指挥">× <kbd>Q</kbd></button></div>
    <div className="quick-crew" role="group" aria-label="选择伙伴">{w.actors.slice(1).map((actor,i)=><button key={actor.id} className={'crew-'+actor.id} aria-pressed={view.commandActor===actor.id} onClick={()=>session.chooseActor(actor.id as 'a'|'b')}><span className="crew-dot"/>{actor.name} <kbd>{i+1}</kbd></button>)}</div>
    <p className="quick-job">{selected.job}</p>
    <div className="assist-options">
      <button disabled={!item} onClick={()=>session.assistContext('item')}><kbd>E</kbd><span><b>接续这份食物</b><small>{item?ITEM_NAMES[item.kind]+(item.location.type==='hand'?' · 放到台面后伙伴会接手':' · 继续下一步工序'):'拿起或面对一份食物'}</small></span></button>
      <button disabled={!station||['supply','traySupply','bin','serve'].includes(station.kind)} onClick={()=>session.assistContext('station')}><kbd>R</kbd><span><b>支援这个工位</b><small>{station?.label??'先走到需要支援的工位'}</small></span></button>
      <button disabled={!order} onClick={()=>session.assistContext('order')}><kbd>T</kbd><span><b>优先完成这单</b><small>{order?'订单 #'+order.id:'等待一张营业订单'}</small></span></button>
    </div>
    <div className={'assist-state '+(selected.assist?.status??'')} role="status"><b>{selected.assist?STATUS[selected.assist.status]:'没有临时指令'}</b><span>{selected.assist?.message??'临时协助结束后，伙伴回到长期岗位。'}</span>{selected.assist&&['received','waiting','executing'].includes(selected.assist.status)&&<button onClick={()=>session.command({type:'assist-cancel',actorId:view.commandActor})}>取消这次指令 <kbd>X</kbd></button>}</div>
    <label className="permanent-role">长期岗位<select aria-label={selected.name+' 长期岗位'} value={selected.role} onChange={e=>session.command({type:'role',actorId:view.commandActor,role:e.target.value as Role})}>{(Object.keys(ROLE_NAMES)as Role[]).map(role=><option key={role} value={role}>{ROLE_NAMES[role]}</option>)}</select></label><p className="role-note">{ROLES[selected.role]} · 先把手上工作放妥</p>
    <button className="button-primary return-command" onClick={session.resume}>回到厨房 <kbd>Q</kbd></button>
  </aside>;
}
