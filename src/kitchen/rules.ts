import { center, createNavigation } from './map';
import { getLevel } from './levels';
import { combinedBurger, isDish, ITEM_NAMES, PROCESS, sameDishes, throwable } from './recipes';
import { HZ, type ActorId, type InteractionPreview, type ItemKind, type KitchenActor, type KitchenEvent, type KitchenItem, type KitchenSnapshot, type KitchenStation, type Point } from './types';
export const THROW_GRAVITY = 12;
export const throwVelocity = (charge: number) => ({ speed: 3 + Math.min(1, Math.max(0, charge)) * 3, vertical: 4.2 + Math.min(1, Math.max(0, charge)) * 1.1, height: 1.15 });
export type Emit = (event: Omit<KitchenEvent, 'seq' | 'tick'>) => void;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const counterKinds = ['counter', 'chop'];
export class KitchenRules {
  private nextItem = 1;
  readonly level;
  readonly navigation;
  private targets = new Map<ActorId, string>();
  constructor(readonly world: KitchenSnapshot, private emit: Emit) { this.level = getLevel(world.levelId); this.navigation = createNavigation(this.level); }
  actor(id: ActorId) { return this.world.actors.find(a => a.id === id)!; }
  item(id: string | null) { return id ? this.world.items.find(i => i.id === id) : undefined; }
  station(id: string) { return this.world.stations.find(s => s.id === id)!; }
  private action(actor: KitchenActor) { actor.completedActions++; this.world.metrics.contributions[actor.id]++; }
  private fresh(kind: ItemKind, actor: KitchenActor): KitchenItem {
    const item: KitchenItem = { id: 'item-' + this.nextItem++, kind, ingredients: kind === 'tray' ? [] : [kind], contents: [], location: { type: 'hand', actorId: actor.id }, createdBy: actor.id, lastHandledBy: actor.id, handledBy: [actor.id] };
    this.world.items.push(item); actor.heldId = item.id; return item;
  }
  private resetStation(station: KitchenStation) { station.itemId = null; station.progress = station.duration = station.burnProgress = station.burnDuration = 0; station.state = 'idle'; station.workerId = null; }
  detach(item: KitchenItem) {
    if (item.location.type === 'hand') this.actor(item.location.actorId).heldId = null;
    else if (item.location.type === 'station') this.resetStation(this.station(item.location.stationId));
    else if (item.location.type === 'tray') { const tray = this.item(item.location.trayId); if (tray) tray.contents = tray.contents.filter(id => id !== item.id); }
  }
  remove(item: KitchenItem) { for (const id of [...item.contents]) { const child = this.item(id); if (child) this.remove(child); } this.detach(item); this.world.items = this.world.items.filter(i => i.id !== item.id); }
  private handle(actor: KitchenActor, item: KitchenItem) {
    if (item.lastHandledBy !== actor.id) { this.world.metrics.handoffs++; this.emit({ type: 'handoff', actorId: actor.id, itemId: item.id, message: actor.name + '接住了' + this.actor(item.lastHandledBy).name + '的' + ITEM_NAMES[item.kind] }); }
    item.lastHandledBy = actor.id; if (!item.handledBy.includes(actor.id)) item.handledBy.push(actor.id);
  }
  take(actor: KitchenActor, item: KitchenItem, caught = false) {
    if (actor.heldId) return false;
    if (actor.id === 'player' && item.location.type === 'station' && this.level.conveyors.some(c => c.stationIds.at(-1) === (item.location as { stationId: string }).stationId && item.conveyorJourney?.id === c.id && item.conveyorJourney.entryIndex === 0 && item.conveyorJourney.steps >= c.stationIds.length - 1)) this.world.mechanicProgress.playerConveyorRetrievals++;
    this.detach(item); this.handle(actor, item); item.location = { type: 'hand', actorId: actor.id }; actor.heldId = item.id;
    this.emit({ type: caught ? 'catch' : 'pickup', actorId: actor.id, itemId: item.id, message: (caught ? '接住' : '拿起') + ITEM_NAMES[item.kind] }); return true;
  }
  move(actor: KitchenActor, dx: number, dy: number): boolean {
    if (!dx && !dy) return false;
    const magnitude = Math.hypot(dx, dy); actor.facing = { x: dx / magnitude, y: dy / magnitude };
    const allowed = (p: Point) => this.navigation.canStand(p) && this.world.actors.every(other => other.id === actor.id || distance(p, other) >= .48);
    let moved = false;
    const steps = Math.max(1, Math.ceil(magnitude / .1));
    for (let i = 0; i < steps; i++) {
      if (allowed({ x: actor.x + dx / steps, y: actor.y })) { actor.x += dx / steps; moved = true; }
      if (allowed({ x: actor.x, y: actor.y + dy / steps })) { actor.y += dy / steps; moved = true; }
    }
    if (moved) actor.state = actor.heldId ? 'carrying' : 'moving';
    return moved;
  }
  reach(actor: KitchenActor, point: Point) {
    const d = distance(actor, point); if (d > 1.28 || d < .001) return false;
    const dot = ((point.x - actor.x) * actor.facing.x + (point.y - actor.y) * actor.facing.y) / d;
    return dot > .52;
  }
  target(actor: KitchenActor): { station?: KitchenStation; item?: KitchenItem; point: Point } | null {
    const choices: { station?: KitchenStation; item?: KitchenItem; point: Point; score: number }[] = [];
    for (const station of this.world.stations) {
      const point = center(station); if (!this.reach(actor, point)) continue;
      const d = distance(actor, point), dot = ((point.x - actor.x) * actor.facing.x + (point.y - actor.y) * actor.facing.y) / d;
      choices.push({ station, point, score: d - .35 * dot });
    }
    for (const item of this.world.items) if (item.location.type === 'ground') {
      const point = { x: item.location.x, y: item.location.y }; if (distance(actor, point) > .9 || (distance(actor, point) > .35 && !this.reach(actor, point))) continue;
      choices.push({ item, point, score: distance(actor, point) - .1 });
    }
    choices.sort((a, b) => a.score - b.score || (a.station?.id ?? a.item!.id).localeCompare(b.station?.id ?? b.item!.id));
    const previous = this.targets.get(actor.id), stable = choices.find(choice => (choice.station?.id ?? choice.item?.id) === previous);
    const selected = stable && stable.score <= (choices[0]?.score ?? Infinity) + .1 ? stable : choices[0];
    if (selected) this.targets.set(actor.id, selected.station?.id ?? selected.item!.id); else this.targets.delete(actor.id);
    return selected ?? null;
  }
  preview(actor: KitchenActor, explicit?: KitchenStation): InteractionPreview | null {
    const target = explicit ? this.reach(actor, center(explicit)) ? { station: explicit, point: center(explicit), item: undefined } : null : this.target(actor);
    const held = this.item(actor.heldId);
    if (!target) {
      if (!held) return null;
      const position = { x: actor.x + actor.facing.x * .58, y: actor.y + actor.facing.y * .58 };
      const valid = this.navigation.canStand(position, .1);
      return { stationId: null, itemId: null, position, label: '放在地上', workLabel: '', action: valid ? 'put' : 'none', valid, reason: valid ? '' : '靠近空台面放下' };
    }
    const station = target.station, stored = target.item ?? this.item(station?.itemId ?? null);
    const result: InteractionPreview = { stationId: station?.id ?? null, itemId: stored?.id ?? null, position: target.point, label: '', workLabel: '', action: 'none', valid: false, reason: '' };
    const allow = (action: InteractionPreview['action'], label: string) => Object.assign(result, { action, label, valid: true });
    const deny = (reason: string) => Object.assign(result, { label: reason, reason });
    if (!station) return held ? deny('先把手里的物品放下') : allow('take', '捡起' + ITEM_NAMES[stored!.kind]);
    if (station.kind === 'supply' || station.kind === 'traySupply') return held ? deny('先把手里的物品放下') : allow('take', '拿' + (station.kind === 'traySupply' ? '餐盒' : ITEM_NAMES[station.supply!]));
    if (station.kind === 'serve') {
      if (!held) return deny('把餐品或套餐餐盒带到这里');
      if (this.world.tutorial?.stage === 'conveyor' && (!this.world.mechanicProgress.playerConveyorLoads || this.world.mechanicProgress.conveyorTransfers < 3 || !this.world.mechanicProgress.playerConveyorRetrievals || held.conveyorJourney?.entryIndex !== 0 || held.conveyorJourney.steps < 3)) return deny('先把可乐放到传餐带最左端，走完整条带后从末端接取；教学不计时');
      const dishes = held.kind === 'tray' ? held.contents.map(id => this.item(id)!.kind).filter(isDish) : isDish(held.kind) ? [held.kind] : [];
      const matches = this.world.orders.filter(o => ['active', 'late'].includes(o.status) && sameDishes(o.dishes, dishes));
      if (station.channel && matches.length && !matches.some(o => !o.channel || o.channel === station.channel)) return deny('请送到' + (matches[0].channel === 'dine-in' ? '左侧堂食窗口' : '右侧外带窗口') + ' · 餐品保留');
      return allow('serve', '交付' + ITEM_NAMES[held.kind]);
    }
    if (station.kind === 'bin') return held ? allow('discard', '丢弃' + ITEM_NAMES[held.kind]) : deny('手里没有需要丢弃的物品');
    if (!held) {
      if (!stored) return deny('空台面 · 把物品放在这里');
      const process = PROCESS[stored.kind];
      if (process?.station === station.kind && ['chop', 'drink'].includes(station.kind)) result.workLabel = station.kind === 'chop' ? '按住 Space 切配' : '按住 Space 接可乐';
      if (stored.kind === 'tray' && stored.contents.length) result.workLabel = '按 Space 取出最后一件';
      return allow('take', '拿起' + ITEM_NAMES[stored.kind] + (station.state === 'cooking' ? '（尚未熟）' : ''));
    }
    if (!stored) {
      const process = PROCESS[held.kind];
      if (['grill', 'fryer', 'drink'].includes(station.kind) && process?.station !== station.kind) return deny(station.kind === 'grill' ? '煎台只接收生肉饼' : station.kind === 'fryer' ? '先在切配台处理土豆或鸡肉' : '先拿空纸杯');
      return allow('put', '放下' + ITEM_NAMES[held.kind]);
    }
    if (stored.kind === 'tray') return !isDish(held.kind) ? deny('先做成餐品，再放入餐盒') : stored.contents.length >= 3 ? deny('餐盒已满 · 拿走出餐或取出一件') : allow('combine', '放入餐盒');
    if (held.kind === 'tray') return !isDish(stored.kind) ? deny('这里只能装入完成的餐品') : held.contents.length >= 3 ? deny('餐盒已满') : allow('combine', '把' + ITEM_NAMES[stored.kind] + '装入手中餐盒');
    if (counterKinds.includes(station.kind) && combinedBurger(stored, held)) return allow('combine', '组合汉堡');
    return deny('台面已有物品 · 先拿走或换空位');
  }
  private reject(actor: KitchenActor, message: string) { this.world.hint = message; this.emit({ type: 'reject', actorId: actor.id, message }); }
  interact(actor: KitchenActor, explicit?: KitchenStation): boolean {
    const p = this.preview(actor, explicit); if (!p?.valid) { if (actor.id === 'player') this.reject(actor, p?.reason || '靠近并面向工位'); return false; }
    const station = p.stationId ? this.station(p.stationId) : undefined, held = this.item(actor.heldId), stored = this.item(p.itemId);
    if (p.action === 'take') {
      if (station?.kind === 'supply' || station?.kind === 'traySupply') { const item = this.fresh(station.kind === 'traySupply' ? 'tray' : station.supply!, actor); this.emit({ type: 'pickup', actorId: actor.id, itemId: item.id, stationId: station.id, message: '拿起' + ITEM_NAMES[item.kind] }); return true; }
      return this.take(actor, stored!);
    }
    if (p.action === 'discard') { this.remove(held!); this.emit({ type: 'place', actorId: actor.id, stationId: station!.id, message: '已清理，重新来一份' }); return true; }
    if (p.action === 'serve') return this.serve(actor, held!, station!);
    if (p.action === 'put') {
      this.detach(held!);
      if (!station) held!.location = { type: 'ground', x: p.position.x, y: p.position.y };
      else {
        station.itemId = held!.id; held!.location = { type: 'station', stationId: station.id };
        if (station.conveyorId) { held!.conveyorJourney = { id: station.conveyorId, entryIndex: station.conveyorIndex ?? 0, steps: 0 }; if (actor.id === 'player') this.world.mechanicProgress.playerConveyorLoads++; }
        const process = PROCESS[held!.kind];
        if (process?.station === station.kind) { station.duration = process.ticks; station.burnDuration = process.burnTicks; station.state = ['grill', 'fryer'].includes(station.kind) ? 'cooking' : 'idle'; }
      }
      this.emit({ type: 'place', actorId: actor.id, stationId: station?.id, itemId: held!.id, message: '放下' + ITEM_NAMES[held!.kind] }); return true;
    }
    if (p.action === 'combine') {
      const tray = held!.kind === 'tray' ? held! : stored!.kind === 'tray' ? stored! : null;
      if (tray) {
        const meal = tray.id === held!.id ? stored! : held!; this.detach(meal); meal.location = { type: 'tray', trayId: tray.id }; tray.contents.push(meal.id); this.handle(actor, meal); this.action(actor);
        this.emit({ type: 'assemble', actorId: actor.id, itemId: tray.id, stationId: station!.id, message: '已装入' + ITEM_NAMES[meal.kind] + ' · ' + tray.contents.length + '/3' }); return true;
      }
      const combination = combinedBurger(stored!, held!)!;
      stored!.handledBy = [...new Set([...stored!.handledBy, ...held!.handledBy, actor.id])]; this.remove(held!); stored!.kind = combination.kind; stored!.ingredients = combination.ingredients; this.handle(actor, stored!); this.action(actor);
      this.emit({ type: 'assemble', actorId: actor.id, itemId: stored!.id, stationId: station!.id, message: ITEM_NAMES[stored!.kind] + '已组合' }); return true;
    }
    return false;
  }
  work(actor: KitchenActor, explicit?: KitchenStation): boolean {
    if (actor.heldId) return false;
    const target = explicit ? this.reach(actor, center(explicit)) ? explicit : undefined : this.target(actor)?.station;
    if (!target || (target.workerId && target.workerId !== actor.id)) return false;
    const item = this.item(target.itemId); if (!item) return false;
    if (item.kind === 'tray') {
      const last = this.item(item.contents.at(-1) ?? null); if (!last) return false; this.take(actor, last); return true;
    }
    const process = PROCESS[item.kind]; if (!process || process.station !== target.kind || !['chop', 'drink'].includes(target.kind)) return false;
    target.workerId = actor.id; target.state = 'working'; target.duration = process.ticks; target.progress++;
    actor.state = 'working'; actor.targetStationId = target.id; actor.workProgress = target.progress / target.duration;
    if (target.progress === 1) this.emit({ type: 'work', actorId: actor.id, stationId: target.id, itemId: item.id, message: target.kind === 'chop' ? '开始切配' : '开始接饮' });
    if (target.progress >= target.duration) { item.kind = process.output; item.ingredients = [process.output]; this.handle(actor, item); this.action(actor); target.state = 'ready'; target.workerId = null; this.emit({ type: 'ready', actorId: actor.id, stationId: target.id, itemId: item.id, message: ITEM_NAMES[item.kind] + '好了' }); }
    return true;
  }
  beginTick() { for (const station of this.world.stations) { station.workerId = null; if (station.state === 'working') station.state = 'idle'; } for (const actor of this.world.actors) { actor.workProgress = 0; actor.dash = false; actor.state = actor.heldId ? 'carrying' : 'idle'; } }
  machines() {
    for (const station of this.world.stations) {
      const item = this.item(station.itemId); if (!item) continue;
      if (station.state === 'cooking') {
        station.progress++;
        if (station.progress >= station.duration) { const process = PROCESS[item.kind]!; item.kind = process.output; item.ingredients = [process.output]; station.state = 'ready'; this.emit({ type: 'ready', stationId: station.id, itemId: item.id, message: ITEM_NAMES[item.kind] + '好了，及时取走' }); }
      } else if (station.state === 'ready' && station.burnDuration > 0) {
        station.burnProgress++;
        if (station.burnProgress >= station.burnDuration) { item.kind = 'burnt'; item.ingredients = ['burnt']; station.state = 'burnt'; this.world.metrics.burnt++; this.emit({ type: 'burnt', stationId: station.id, itemId: item.id, message: station.label + '食物焦了 · 取走后丢弃' }); }
      }
    }
  }
  conveyors() {
    for (const conveyor of this.level.conveyors) {
      if (this.world.tick % conveyor.ticksPerStep !== 0) continue;
      // Move from the downstream end. Every item advances at most one cell; full buffers stay put.
      for (let index = conveyor.stationIds.length - 2; index >= 0; index--) {
        const from = this.station(conveyor.stationIds[index]), to = this.station(conveyor.stationIds[index + 1]);
        const item = this.item(from.itemId); if (!item || to.itemId) continue;
        this.resetStation(from); to.itemId = item.id; item.location = { type: 'station', stationId: to.id };
        if (item.conveyorJourney?.id !== conveyor.id) item.conveyorJourney = { id: conveyor.id, entryIndex: index, steps: 0 };
        item.conveyorJourney.steps++;
        this.world.mechanicProgress.conveyorTransfers++;
        this.emit({ type: 'conveyor', stationId: to.id, itemId: item.id, message: '传餐带送来' + ITEM_NAMES[item.kind] });
      }
    }
  }
  throw(actor: KitchenActor) {
    const item = this.item(actor.heldId), charge = actor.throwCharge; actor.throwCharge = 0;
    if (!item || !throwable(item.kind)) { if (actor.id === 'player') this.reject(actor, '只能投递未装盒的食材；餐品和饮料请手递'); return; }
    const velocity = throwVelocity(charge); this.detach(item);
    item.location = { type: 'air', x: actor.x + actor.facing.x * .5, y: actor.y + actor.facing.y * .5, height: velocity.height, vx: actor.facing.x * velocity.speed, vy: actor.facing.y * velocity.speed, vz: velocity.vertical };
    this.emit({ type: 'throw', actorId: actor.id, itemId: item.id, message: '投出' + ITEM_NAMES[item.kind] });
  }
  flights() {
    for (const item of [...this.world.items]) {
      if (item.location.type !== 'air') continue;
      const f = item.location; f.x += f.vx / HZ; f.y += f.vy / HZ; f.height += f.vz / HZ; f.vz -= THROW_GRAVITY / HZ;
      if (f.x < 1.2 || f.x > this.level.width - 1.2) { f.x = Math.min(this.level.width - 1.2, Math.max(1.2, f.x)); f.vx *= -.4; }
      if (f.y < 1.2 || f.y > this.level.height - 1.2) { f.y = Math.min(this.level.height - 1.2, Math.max(1.2, f.y)); f.vy *= -.4; }
      const catcher = this.world.actors.find(a => !a.heldId && a.id !== item.lastHandledBy && f.height < 1.45 && f.height > .2 && distance(a, f) < .5);
      if (catcher) { this.take(catcher, item, true); continue; }
      const table = this.world.stations.find(s => counterKinds.includes(s.kind) && !s.itemId && Math.floor(f.x) === s.x && Math.floor(f.y) === s.y);
      if (table && f.vz < 0 && f.height < .95) { item.location = { type: 'station', stationId: table.id }; table.itemId = item.id; const process = PROCESS[item.kind]; if (process?.station === table.kind) table.duration = process.ticks; this.emit({ type: 'place', stationId: table.id, itemId: item.id, message: '食材落在交接台' }); continue; }
      if (f.height <= 0) {
        let position = { x: f.x, y: f.y };
        if (!this.navigation.canStand(position, .1)) {
          const candidates: Point[] = []; for (let y = 1; y < this.level.height - 1; y++) for (let x = 1; x < this.level.width - 1; x++) if (!this.navigation.isSolid(x, y)) candidates.push(center({ x, y }));
          position = candidates.sort((a, b) => distance(a, f) - distance(b, f) || a.y - b.y || a.x - b.x)[0];
        }
        item.location = { type: 'ground', ...position };
      }
    }
  }
  private serve(actor: KitchenActor, held: KitchenItem, station: KitchenStation) {
    const mealItems = held.kind === 'tray' ? held.contents.map(id => this.item(id)!) : [held];
    if (!mealItems.length || mealItems.some(i => !isDish(i.kind))) { this.reject(actor, '餐品尚未完成 · 保留在手中，可以继续处理'); this.world.metrics.mistakes++; return false; }
    const dishes = mealItems.map(i => i.kind).filter(isDish);
    const order = this.world.orders.filter(o => ['active', 'late'].includes(o.status) && sameDishes(o.dishes, dishes) && (!station.channel || !o.channel || station.channel === o.channel)).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id))[0];
    if (!order) { this.reject(actor, '订单不匹配 · 食物保留，核对餐盒缺项或多放的餐品'); this.world.metrics.mistakes++; this.world.metrics.score = Math.max(0, this.world.metrics.score - 10); return false; }
    const first = this.world.orders.find(o => ['active', 'late'].includes(o.status)), remaining = Math.max(0, (order.due - this.world.serviceTick) / Math.max(1, order.due - order.arrival));
    this.world.metrics.combo = first?.id === order.id ? Math.min(4, this.world.metrics.combo + 1) : 1;
    order.points = dishes.length * 40 + Math.ceil(remaining * 8) * this.world.metrics.combo; order.status = 'served'; order.servedAt = this.world.serviceTick; order.servedBy = actor.id;
    if (actor.id === 'player' && station.channel) this.world.mechanicProgress.correctWindowServes++;
    this.world.metrics.score += order.points; this.world.metrics.served++; if (this.world.serviceTick <= order.due) this.world.metrics.onTime++;
    this.world.metrics.bestCombo = Math.max(this.world.metrics.bestCombo, this.world.metrics.combo); actor.deliveries++; this.action(actor); this.remove(held);
    const served = this.world.orders.filter(o => o.status === 'served'); this.world.metrics.averageWait = served.reduce((sum, o) => sum + o.servedAt! - o.arrival, 0) / served.length / HZ;
    this.emit({ type: 'serve', actorId: actor.id, orderId: order.id, message: actor.name + '完成 #' + order.id + ' · +' + order.points }); return true;
  }
}
