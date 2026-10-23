import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { HZ, type Dish, type ItemKind, type KitchenOptions, type KitchenOrder, type KitchenSnapshot, type LevelId } from '../kitchen/types';
import { DISH_NAMES, ITEM_NAMES, ROLE_NAMES, isDish } from '../kitchen/recipes';
import { LEVELS, getLevel } from '../kitchen/levels';
import { CommandPanel } from './CommandPanel';
import { VisualSettings } from './VisualSettings';
import { ChallengeImport } from './ChallengeImport';
import { audio } from '../game/audio';
import { KitchenScene3D } from './scene3d';
import { KitchenSession, hasLearnedKitchen } from './session';

const PHASE_NAMES = { tutorial: '实操教学', prep: '开店准备', service: '营业中', closing: '最后出餐', results: '营业结束' };
const DISH_STEPS: Record<Dish, string[]> = {
  burger: ['肉饼放上煎台，等待煎熟', '熟肉饼 + 面包放在同一台面', '拿起牛肉堡，到出餐口交付'],
  cheeseburger: ['熟肉饼 + 面包组合', '把芝士加入牛肉堡', '拿起芝士堡，按订单配餐'],
  fries: ['土豆放上切配台', '按住空格切好，再放入炸锅', '及时取出金黄薯条'],
  nuggets: ['鸡肉放上切配台', '按住空格处理，再放入炸锅', '及时取出鸡块'],
  cola: ['从纸杯柜取空杯', '把杯子放在可乐机', '按住空格接满，再拿走'],
};
const timeLabel = (ticks: number) => { const seconds = Math.max(0, Math.ceil(ticks / HZ)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };

function FoodIcon({ kind, icons, size = 48 }: { kind: ItemKind; icons: Record<string, string>; size?: number }) {
  return icons[kind] ? <img className="food-icon" src={icons[kind]} width={size} height={size} alt={ITEM_NAMES[kind]} draggable="false"/> : <span className="food-icon-placeholder" style={{ width: size, height: size }} aria-label={ITEM_NAMES[kind]}/>;
}
function trayChecklist(w: KitchenSnapshot, order: KitchenOrder) {
  let best: Dish[] = [], bestCount = 0;
  for (const tray of w.items.filter(item => item.kind === 'tray')) {
    const dishes = tray.contents.map(id => w.items.find(item => item.id === id)?.kind).filter((kind): kind is Dish => !!kind && isDish(kind));
    const available = [...dishes]; let count = 0;
    for (const dish of order.dishes) { const index = available.indexOf(dish); if (index >= 0) { count++; available.splice(index, 1); } }
    if (count > bestCount) { bestCount = count; best = dishes; }
  }
  if (order.dishes.length === 1 && w.items.some(item => item.kind === order.dishes[0])) return [true];
  return order.dishes.map(dish => { const index = best.indexOf(dish); if (index < 0) return false; best.splice(index, 1); return true; });
}
function OrderTicket({ order, world, icons, select }: { order: KitchenOrder; world: KitchenSnapshot; icons: Record<string, string>; select: () => void }) {
  const checklist = trayChecklist(world, order), remaining = order.due - world.serviceTick, forecast = order.status === 'forecast';
  const percent = forecast ? 100 : Math.max(0, Math.min(100, remaining / (order.due - order.arrival) * 100));
  const active = world.priorityOrderId === order.id, practice = world.phase === 'tutorial';
  return <button className={'order-ticket ' + (active ? 'is-priority ' : '') + (forecast ? 'is-forecast ' : '') + (remaining < 20 * HZ && !forecast ? 'is-urgent' : '')} onClick={select} disabled={forecast || ['served', 'missed'].includes(order.status)} aria-pressed={active} aria-label={'订单 ' + order.id + '，' + order.dishes.map(dish => DISH_NAMES[dish]).join('、') + (order.channel==='dine-in'?'，堂食窗口':order.channel==='takeaway'?'，外带窗口':'') + (active ? '，优先制作' : '')}>
    <div className="ticket-heading"><b>#{order.id}{order.channel&&<small className={'channel-badge '+order.channel}>{order.channel==='dine-in'?'○ 堂食':'□ 外带'}</small>}</b><span>{practice ? '练习 · 不计时' : forecast ? '即将到单' : order.status === 'served' ? '已出餐' : order.status === 'late' ? '顾客还在等' : timeLabel(remaining)}</span>{active && <i aria-hidden="true">★</i>}</div>
    <div className="ticket-foods">{order.dishes.map((dish, i) => <div key={dish + i} className={checklist[i] ? 'food-ready' : ''}><FoodIcon kind={dish} icons={icons} size={47}/><small>{checklist[i] ? '✓ 已备好' : dish === 'burger' ? '牛肉堡' : dish === 'cheeseburger' ? '芝士堡' : DISH_NAMES[dish]}</small></div>)}</div>
    <div className="ticket-timer"><span style={{ width: percent + '%' }}/></div>
  </button>;
}
function KitchenStage({ session, reload }: { session: KitchenSession; reload: number }) {
  const ref = useRef<HTMLDivElement>(null),levelId=session.getView().game.levelId;
  useEffect(() => { const scene = new KitchenScene3D(); void scene.mount(ref.current!, session); return () => scene.destroy(session); }, [session, reload, levelId]);
  return <div className="kitchen-stage" data-testid="kitchen" ref={ref}/>;
}
function SoundSettings() {
  const settings = useSyncExternalStore(audio.subscribe, audio.getSettings);
  return <div className="sound-settings"><div><b>厨房声音</b><button onClick={() => { audio.unlock(); audio.setSettings({ muted: !settings.muted }); }} aria-pressed={settings.muted}>{settings.muted ? '取消静音' : '静音'}</button></div>{(['master', 'music', 'effects'] as const).map((key, i) => <label key={key}><span>{['主音量', '音乐', '音效'][i]}</span><input aria-label={['主音量', '音乐', '音效'][i]} type="range" min="0" max="1" step="0.05" value={settings[key]} onChange={event => { audio.unlock(); audio.setSettings({ [key]: Number(event.target.value) }); }}/><output>{Math.round(settings[key] * 100)}%</output></label>)}</div>;
}
function Dialog({ title, close, children, className = '' }: { title: string; close?: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { const last = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')?.focus(); return () => { if (last?.isConnected) last.focus(); }; }, []);
  return <div className="dialog-shade"><section ref={ref} className={'game-dialog ' + className} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key === 'Escape' && close) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    const elements = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')];
    if (!elements.length) return;
    if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)!.focus(); }
    else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
  }}><div className="dialog-heading"><div><span className="eyebrow">McRUSH / 麦门厨房</span><h2>{title}</h2></div>{close && <button className="close-button" onClick={close} aria-label="关闭">×</button>}</div>{children}</section></div>;
}
function OrdersPanel({ session }: { session: KitchenSession }) {
  const view = session.getView(), w = view.game;
  return <Dialog title="订单与做法" close={session.resume} className="orders-dialog"><p className="dialog-lede">厨房继续运行。点亮一张订单，让伙伴优先补齐这一单。</p><div className="orders-panel-layout"><div className="all-orders">{w.orders.map(order => <OrderTicket key={order.id} order={order} world={w} icons={view.icons} select={() => session.command({ type: 'priority', orderId: w.priorityOrderId === order.id ? null : order.id })}/>)}</div><div className="recipe-book" tabIndex={0} aria-label="五种餐品做法">{getLevel(w.levelId).menu.map(dish => <div className="recipe" key={dish}><div><FoodIcon kind={dish} icons={view.icons} size={52}/><h3>{DISH_NAMES[dish]}</h3></div><ol>{DISH_STEPS[dish].map(step => <li key={step}>{step}</li>)}</ol></div>)}<p className="recipe-note">套餐需要一个餐盒：把餐品逐份放进去，配齐订单后再出餐。食物在厨房中共享，不绑定某一单。</p></div></div></Dialog>;
}
function Results({ session }: { session: KitchenSession }) {
  const { game: w, icons } = session.getView(), m = w.metrics, total = w.orders.length, rating=w.shiftRating, levelIndex=LEVELS.findIndex(l=>l.id===w.levelId);
  return <Dialog title="这一班，辛苦了！" className="results-dialog"><p className="dialog-lede">{getLevel(w.levelId).name}{session.getView().challenge?' · 主题挑战':''}</p><div className="result-stars" aria-label={(rating?.stars??0)+' 星'}>{[1,2,3].map(n=><span key={n} className={n<=(rating?.stars??0)?'earned':''}>★</span>)}</div><div className="result-score"><span>本班得分</span><strong>{m.score}</strong><b>{m.served} / {total} 单完成</b></div><div className="result-metrics"><div><b>{m.onTime}</b><span>准时出餐</span></div><div><b>{m.bestCombo}</b><span>最高连单</span></div><div><b>{m.handoffs}</b><span>伙伴交接</span></div><div><b>{m.burnt}</b><span>食物焦糊</span></div></div><div className="result-contribution-line" aria-label="错餐与工序贡献"><span>错餐 <b>{m.mistakes}</b> 次</span><span className="contribution-label">完成工序</span>{w.actors.map(actor => <span key={actor.id}>{actor.name} <b>{m.contributions[actor.id]}</b> 次</span>)}<small>加工 · 组装 · 装盒 · 出餐</small></div><div className="result-orders">{w.orders.map(order => <div key={order.id} className={order.status === 'served' ? 'delivered' : 'missed'}><span>#{order.id}</span>{order.dishes.map((dish, i) => <FoodIcon kind={dish} key={dish + i} icons={icons} size={31}/>)}<b>{order.status === 'served' ? '✓' : '—'}</b></div>)}</div><div className="result-tip"><b>{rating?.nextStar??'三颗星，配合得真漂亮。'}</b>{rating?.reasons.map(reason=><p key={reason}>{reason}</p>)}{session.getView().saveError&&<p role="alert">{session.getView().saveError}</p>}</div><div className="dialog-actions"><button className="button-primary" onClick={session.retry}>同关重试</button>{!session.getView().challenge&&<button onClick={() => session.begin(false, (w.seed + 1) >>> 0)}>新种子挑战</button>}{levelIndex<2&&<button onClick={()=>{session.home();session.selectLevel(LEVELS[levelIndex+1].id);}}>下一关 →</button>}<button onClick={session.home}>关卡选择</button></div></Dialog>;
}

export function App() {
  const [session] = useState(() => {
    const options: KitchenOptions = { seed: 1024, tutorial: false,levelId:'first-shift' };
    if (import.meta.env.MODE === 'e2e') {
      const params = new URLSearchParams(location.search), scenario = params.get('scenario');
      if (scenario === 'manual') Object.assign(options, { levelId:'night-relay', ai: false, prepSeconds: 0, serviceSeconds: 600, closingSeconds: 60, orders: [{ dishes: ['burger'], arrival: 0, due: 600 }, { dishes: ['cheeseburger'], arrival: 0, due: 600 }, { dishes: ['fries'], arrival: 0, due: 600 }, { dishes: ['nuggets'], arrival: 0, due: 600 }, { dishes: ['cola'], arrival: 0, due: 600 }, { dishes: ['burger', 'fries', 'cola'], arrival: 0, due: 600 }] });
      if(LEVELS.some(l=>l.id===params.get('level')))options.levelId=params.get('level') as LevelId;
      if (params.get('ai') === 'false') options.ai = false;
      for (const key of ['prepSeconds', 'serviceSeconds', 'closingSeconds'] as const) { const value = params.get(key); if (value !== null && /^\d+$/.test(value) && Number(value) <= 3600) options[key] = Number(value); }
      if (params.has('orders')) {
        try {
          const orders: unknown = JSON.parse(params.get('orders')!);
          if (Array.isArray(orders) && orders.length > 0 && orders.length <= 30 && orders.every(o => o && Array.isArray(o.dishes) && o.dishes.length > 0 && o.dishes.length <= 4 && o.dishes.every((d: unknown) => typeof d === 'string' && Object.hasOwn(DISH_NAMES, d)) && Number.isFinite(o.arrival) && Number.isFinite(o.due) && o.arrival >= 0 && o.due > o.arrival)) options.orders = orders;
        } catch { /* Invalid test fixtures do not change the normal level. */ }
      }
    }
    return new KitchenSession(options);
  });
  const view = useSyncExternalStore(session.subscribe, session.getView), w = view.game;
  const [importing,setImporting]=useState(false);
  const [seed, setSeed] = useState('1024'), [settings, setSettings] = useState(false), [reload, setReload] = useState(0), [seedError, setSeedError] = useState('');
  useEffect(() => { session.start(); return () => session.stop(); }, [session]);
  useEffect(() => {
    if (import.meta.env.MODE !== 'e2e') return;
    const hook = Object.freeze({ snapshot: () => session.engine.getSnapshot(), guide: () => session.engine.getGuide(), preview: () => session.engine.getInteractionPreview(), paused: () => session.getView().paused, performance: () => session.diagnostics(), audio: () => audio.diagnostics(), commandLog: () => session.commandLog() });
    (window as Window & { __MCKITCHEN__?: typeof hook }).__MCKITCHEN__ = hook;
    return () => { delete (window as Window & { __MCKITCHEN__?: typeof hook }).__MCKITCHEN__; };
  }, [session]);
  const begin = (learn: boolean) => { if (!/^\d+$/.test(seed) || Number(seed) > 4294967295) { setSeedError('请输入 0–4294967295 的整数种子'); return; } setSeedError(''); session.begin(learn, Number(seed)); };
  const player = w.actors[0], held = w.items.find(item => item.id === player.heldId), preview = session.engine.getInteractionPreview(), guide = session.engine.getGuide();
  const activeOrders = w.orders.filter(order => order.status === 'active' || order.status === 'late');
  const forecast = w.orders.find(order => order.status === 'forecast');
  const visibleOrders = [...activeOrders.slice(0, 4), ...(activeOrders.length < 3 && forecast ? [forecast] : [])];
  const title = view.screen === 'title',level=getLevel(w.levelId),levelIndex=LEVELS.findIndex(l=>l.id===w.levelId);
  return <main className={'experience ' + (title ? 'at-title' : 'in-game') + (view.paused ? ' is-paused' : '')+' time-'+level.timeOfDay+(view.preferences.reducedEffects?' reduced-effects':'')}>
    <KitchenStage session={session} reload={reload}/>
    {title ? <><div className="title-vignette"/><section className="title-content"><p className="eyebrow"><span/> 一间厨房，三个伙伴</p><h1>McRush<span>麦门厨房</span></h1><p className="title-copy">每一份热乎，<br/>都有你的接力。</p><nav className="level-selection" aria-label="选择关卡">{LEVELS.map((l,i)=><button key={l.id} aria-label={'选择关卡 '+(i+1)+' '+l.name} aria-pressed={w.levelId===l.id} onClick={()=>session.selectLevel(l.id)}><strong>0{i+1}</strong><span><b>{l.name}</b><small>{l.subtitle} · {l.serviceSeconds/60} 分钟</small></span><em aria-label={(view.scores[l.id]?.stars??0)+' 星'}>{[1,2,3].map(n=><i key={n} className={n<=(view.scores[l.id]?.stars??0)?'earned':''}>★</i>)}</em></button>)}</nav>{view.challenge&&<div className="active-challenge"><span>活动挑战 · {view.challenge.title}</span><button onClick={()=>session.clearChallenge()}>恢复普通关卡</button></div>}<div className="title-actions"><button className="button-primary start-button" aria-label="开始游戏" disabled={!view.ready} onClick={()=>begin(!hasLearnedKitchen(w.levelId))}>开始营业 <span>→</span></button><button className="button-subtle" disabled={!view.ready} onClick={()=>begin(true)}>实操教学</button></div><p className="learning-note">第一次进这关？先来一次不计时练习。</p><div className="title-keys"><span><kbd>WASD</kbd> 移动</span><span><kbd>E</kbd> 取放</span><span><kbd>Space</kbd> 加工</span><span><kbd>Q</kbd> 指挥</span></div><div className="title-links"><button className="settings-link" onClick={()=>setSettings(true)}>画面与声音</button><button className="settings-link" onClick={()=>setImporting(true)}>导入活动挑战</button></div>{view.saveError&&<p role="alert">{view.saveError}</p>}<p className="title-footnote">桌面键鼠 · 两位伙伴在本机运行 · 无需账号或 API Key</p></section><div className="title-scene-label"><small>SHIFT 0{levelIndex+1} / {level.timeOfDay==='night'?'NIGHT':level.timeOfDay==='noon'?'LUNCH':'MORNING'}</small><span>{level.name}</span><small>{level.subtitle}</small></div></> : <>
      <header className="top-hud"><div className="level-heading"><b>McRush</b><span>{level.name}</span><small>{PHASE_NAMES[w.phase]}</small></div><div className="order-rail" aria-label="当前订单">{visibleOrders.map(order => <OrderTicket key={order.id} order={order} world={w} icons={view.icons} select={() => session.command({ type: 'priority', orderId: w.priorityOrderId === order.id ? null : order.id })}/>)}{!visibleOrders.length && <div className="no-orders">{w.phase === 'tutorial' ? '先练手，再开店' : '把厨房准备好，好单马上来。'}</div>}</div><div className="top-actions"><button onClick={() => session.setPanel('orders')} aria-label="订单总览">订单 <kbd>Tab</kbd>{activeOrders.length > 4 && <em>+{activeOrders.length - 4}</em>}</button><button onClick={() => session.pause()} aria-label="暂停">Ⅱ <kbd>Esc</kbd></button></div></header>
      {!w.tutorial&&w.wave&&w.wave.startsIn<20*HZ&&<div className="wave-notice" role="status"><b>下一波 · {timeLabel(w.wave.startsIn)}</b><span>{w.wave.label}</span></div>}
      {w.tutorial && <section className="tutorial-instruction" aria-label="实操教学"><div className="tutorial-count">{w.tutorial.step}<small> / {w.tutorial.total}</small></div><div><strong data-testid="tutorial-step">{w.tutorial.title}</strong><p>{w.tutorial.text}</p></div><button onClick={() => session.command({ type: 'tutorial-skip' })}>跳过教学</button></section>}
      <div className="kitchen-interaction" data-testid="guide" data-state={preview?.valid ? 'ready' : preview ? 'blocked' : 'walking'}><div className="interaction-action">{preview ? <><kbd>{preview.workLabel ? 'Space' : 'E'}</kbd><strong>{preview.workLabel || (preview.valid ? preview.label : preview.reason)}</strong></> : <><span className="tiny-arrow">⌖</span><strong>{guide.title}</strong></>}</div><span>{held ? '手持 ' + ITEM_NAMES[held.kind] : '空手'}{held?.kind === 'tray' ? ` · ${held.contents.length} 份餐品` : ''}</span></div>
      <footer className="bottom-hud"><div className="player-card"><span className="crew-dot"/>{held ? <FoodIcon kind={held.kind} icons={view.icons} size={45}/> : <span className="empty-hand">E</span>}<div><b>你 <span>蓝色遮阳帽</span></b><small>{held ? ITEM_NAMES[held.kind] : '拿起眼前的食材'}</small><div className="stamina-track" aria-label="冲刺体力"><i style={{ width: Math.max(0, Math.min(100, player.stamina * 100)) + '%' }}/></div></div></div><div className="crew-strip">{w.actors.slice(1).map(actor => <div className={'crew-status crew-' + actor.id} key={actor.id}><span className="crew-dot"/><div><b>{actor.name}<small>{ROLE_NAMES[actor.role]}</small></b><span>{actor.assist&&['received','waiting','executing'].includes(actor.assist.status)?actor.assist.message:actor.job||'寻找需要帮忙的工位'}</span></div>{actor.heldId && <FoodIcon kind={w.items.find(item => item.id === actor.heldId)?.kind ?? 'bun'} icons={view.icons} size={32}/>}</div>)}</div><button className="command-button" aria-label="协作 Q" onClick={() => session.setPanel('command')}><kbd>Q</kbd><b>指挥</b></button><div className="score-card"><span>得分</span><b data-testid="score">{w.metrics.score}</b><small>{w.metrics.served} 单出餐 {w.metrics.combo > 1 && ' · ' + w.metrics.combo + ' 连单'}</small></div><div className={'clock-card ' + (w.phaseRemaining < 30 * HZ && w.phase !== 'tutorial' ? 'clock-warning' : '')}><span>{PHASE_NAMES[w.phase]}</span><b data-testid="clock">{w.phase === 'tutorial' ? '∞' : timeLabel(w.phaseRemaining)}</b><small>{w.phase === 'tutorial' ? '不计时' : w.phase === 'prep' ? '准备好，马上开店' : '热乎出餐！'}</small></div></footer>
      <div className="control-strip"><span><kbd>WASD</kbd> 移动 <kbd>E</kbd> 取放 <kbd>Space</kbd> 按住加工 <kbd>Shift</kbd> 冲刺 <kbd>F</kbd> 按住蓄力 / 松开投掷</span><span className="live-feedback" role="status">{w.hint}</span></div>
    </>}
    {!view.ready && <div className={'loading-panel ' + (view.error ? 'has-error' : '')} role={view.error ? 'alert' : 'status'}><span className="loading-icon">{view.error ? '!' : 'M'}</span><div><b>{view.error ? '厨房还没准备好' : '正在开灯，准备午餐…'}</b><p>{view.error || view.loading.label}</p>{!view.error && <progress max={view.loading.total} value={view.loading.loaded} aria-label="厨房模型加载进度"/>}</div>{view.error && <button onClick={() => setReload(reload + 1)}>重新加载</button>}</div>}
    {settings && <Dialog title="画面与声音" close={() => setSettings(false)} className="settings-dialog"><VisualSettings session={session}/><SoundSettings/><label className="seed-setting">挑战种子<input aria-label="挑战种子" disabled={!!view.challenge} value={seed} inputMode="numeric" onChange={event => setSeed(event.target.value)}/></label><p className="setting-note">同一种子会使用相同订单。每次可以尝试不同分工。</p>{seedError && <p role="alert">{seedError}</p>}<button className="button-primary" onClick={() => setSettings(false)}>回到厨房</button></Dialog>}
    {importing&&<Dialog title="活动主题挑战" close={()=>setImporting(false)} className="challenge-dialog"><ChallengeImport session={session} close={()=>setImporting(false)}/></Dialog>}
    {view.panel === 'orders' && <OrdersPanel session={session}/>}{view.panel === 'command' && <CommandPanel session={session}/>}
    {view.panel === 'pause' && <Dialog title="歇一小会儿" className="pause-dialog"><p className="pause-copy">{view.pauseReason || '厨房已暂停，伙伴和订单都在等你。'}</p><button className="button-primary" onClick={session.resume}>继续游戏</button><div className="dialog-actions"><button onClick={session.retry}>同关重试</button><button onClick={session.home}>返回标题</button></div><VisualSettings session={session}/><SoundSettings/></Dialog>}
    {w.phase === 'results' && view.screen === 'game' && <Results session={session}/>}
  </main>;
}
