import { center, tile } from './map';
import { burgerParts, DISH_NAMES, dishSubset, isDish, ITEM_NAMES, PROCESS, sameDishes } from './recipes';
import { KitchenRules } from './rules';
import { HZ, type ActorId, type Dish, type ItemKind, type KitchenActor, type KitchenItem, type KitchenOrder, type KitchenStation, type Point } from './types';

type Step = { stationId: string; action: 'take' | 'put' | 'work' | 'unpack' | 'serve'; itemId?: string; kind?: ItemKind; output?: ItemKind; occupied?: string };
type Job = { label: string; steps: Step[]; claims: string[]; future?: ItemKind; index: number; path: Point[]; destination: string; blocked: number; detour?: Point; detourAt?: number; assistId?: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const key = (p: Point) => `${Math.floor(p.x)},${Math.floor(p.y)}`;
/** Planner reservations are temporary. Food itself always belongs to a physical location, never an order. */
export class KitchenAI {
  private jobs = new Map<ActorId, Job>();
  private retry = new Map<ActorId, number>();
  constructor(private rules: KitchenRules) {}
  private get world() { return this.rules.world; }
  private get playerPacksTutorial() { return this.world.tutorial?.stage === 'combo'; }
  private claimed(id: string, actor: KitchenActor) { return [...this.jobs].some(([owner, job]) => owner !== actor.id && job.claims.includes(id)); }
  private protected(station: KitchenStation) {
    const player = this.rules.actor('player');
    return station.workerId === 'player' || (player.targetStationId === station.id && distance(player, center(station)) < 1.5);
  }
  private available(station: KitchenStation, actor: KitchenActor) { return !this.claimed(station.id, actor) && !this.protected(station); }
  private publicItems(actor: KitchenActor, kinds?: readonly ItemKind[]) {
    return this.world.items.filter(i => i.location.type === 'station' && (!kinds || kinds.includes(i.kind)) && this.available(this.rules.station(i.location.stationId), actor) && this.rules.station(i.location.stationId).state !== 'cooking' && !this.claimed(i.id, actor));
  }
  private spot(actor: KitchenActor, kinds: readonly KitchenStation['kind'][], empty = true, preferredZone?: string) {
    const requested = actor.assist?.target.type === 'station' && ['received', 'waiting', 'executing'].includes(actor.assist.status) ? actor.assist.target.id : null;
    return this.world.stations.filter(s => kinds.includes(s.kind) && !s.conveyorId && (!empty || !s.itemId) && this.available(s, actor)).sort((a, b) => Number(b.id === requested) - Number(a.id === requested) || (a.zone === preferredZone ? -5 : 0) - (b.zone === preferredZone ? -5 : 0) + distance(actor, center(a.ports[0])) - distance(actor, center(b.ports[0])) || a.id.localeCompare(b.id))[0];
  }
  private source(item: KitchenItem): Step { return { stationId: (item.location as { type: 'station'; stationId: string }).stationId, action: 'take', itemId: item.id, kind: item.kind }; }
  private supply(kind: ItemKind): Step { return { stationId: kind === 'tray' ? 'trays' : this.world.stations.find(s => s.supply === kind)!.id, action: 'take', kind }; }
  private put(station: KitchenStation, occupied?: string): Step { return { stationId: station.id, action: 'put', ...(occupied ? { occupied } : {}) }; }
  private job(label: string, steps: Step[], future?: ItemKind): Job {
    return { label, steps, claims: [...new Set(steps.flatMap(s => [s.stationId, ...(s.itemId ? [s.itemId] : []), ...(s.occupied ? [s.occupied] : [])]))], future, index: 0, path: [], destination: '', blocked: 0 };
  }
  private orders(actor?: KitchenActor) {
    return this.world.orders.filter(o => o.status === 'active' || o.status === 'late').sort((a, b) => Number(b.id === (actor?.assist?.target.type === 'order' && ['executing', 'waiting', 'received'].includes(actor.assist.status) ? actor.assist.target.id : this.world.priorityOrderId)) - Number(a.id === (actor?.assist?.target.type === 'order' && ['executing', 'waiting', 'received'].includes(actor.assist.status) ? actor.assist.target.id : this.world.priorityOrderId)) || a.due - b.due || a.id.localeCompare(b.id));
  }
  private pending(kind: ItemKind) { return [...this.jobs.values()].filter(j => j.future === kind).length; }
  private count(kind: ItemKind) { return this.world.items.filter(i => i.kind === kind).length; }
  private trayDishes(tray: KitchenItem) { return tray.contents.map(id => this.rules.item(id)!.kind).filter(isDish); }
  private transfer(actor: KitchenActor, item: KitchenItem, target: KitchenStation, label: string, occupied?: string) {
    if (!this.available(target, actor)) return null;
    return this.job(label, [this.source(item), this.put(target, occupied)]);
  }
  private deliveryWindow(actor: KitchenActor, item: KitchenItem) {
    const dishes = item.kind === 'tray' ? this.trayDishes(item) : isDish(item.kind) ? [item.kind] : [];
    const order = this.orders(actor).find(order => sameDishes(order.dishes, dishes));
    if (!order) return undefined;
    return this.world.stations.filter(s => s.kind === 'serve' && (!s.channel || !order.channel || s.channel === order.channel) && this.available(s, actor)).sort((a, b) => distance(actor, center(a)) - distance(actor, center(b)) || a.id.localeCompare(b.id))[0];
  }
  private deliver(actor: KitchenActor, item: KitchenItem) {
    const window = this.deliveryWindow(actor, item); if (!window) return null;
    return this.job('出餐 · ' + ITEM_NAMES[item.kind], [this.source(item), { stationId: window.id, action: 'serve' }]);
  }
  private packing(actor: KitchenActor, orders: KitchenOrder[]) {
    if (this.playerPacksTutorial) return null;
    const available = this.publicItems(actor);
    for (const order of orders) {
      if (order.dishes.length === 1) {
        const food = available.find(i => i.kind === order.dishes[0] || (i.kind === 'tray' && sameDishes(this.trayDishes(i), order.dishes)));
        if (food) return this.deliver(actor, food);
        continue;
      }
      const tray = available.filter(i => i.kind === 'tray' && dishSubset(this.trayDishes(i), order.dishes)).sort((a, b) => b.contents.length - a.contents.length)[0];
      if (tray) {
        const contents = this.trayDishes(tray);
        if (sameDishes(contents, order.dishes)) return this.deliver(actor, tray);
        const remaining = [...order.dishes]; for (const d of contents) remaining.splice(remaining.indexOf(d), 1);
        const food = available.find(i => isDish(i.kind) && remaining.includes(i.kind));
        if (food) return this.transfer(actor, food, this.rules.station((tray.location as { stationId: string }).stationId), '配齐套餐 · ' + DISH_NAMES[food.kind as Dish], tray.id);
        // Two actors may have started complementary boxes. Repack physical food instead of deadlocking.
        const donor = available.find(i => i.kind === 'tray' && i.id !== tray.id && i.contents.length === 1 && !orders.some(o => sameDishes(this.trayDishes(i), o.dishes)) && sameDishes([...contents, this.rules.item(i.contents[0])!.kind as Dish], order.dishes));
        if (donor?.location.type === 'station') {
          const last = this.rules.item(donor.contents.at(-1)!)!;
          return this.job('合并未完成的套餐', [{ stationId: donor.location.stationId, action: 'unpack', itemId: donor.id, kind: last.kind }, this.put(this.rules.station((tray.location as { stationId: string }).stationId), tray.id)]);
        }
      } else {
        const foodCount = order.dishes.filter(d => available.some(i => i.kind === d)).length;
        const table = this.spot(actor, ['counter'], true, 'assembly');
        if (foodCount && table && !this.pending('tray')) return this.job('摆好套餐餐盒', [this.supply('tray'), this.put(table)], 'tray');
      }
    }
    return null;
  }
  private rescue(actor: KitchenActor) {
    for (const item of this.publicItems(actor, ['burnt', 'patty', 'fries', 'nuggets'])) {
      const station = this.rules.station((item.location as { stationId: string }).stationId);
      if (item.kind === 'burnt') { const bin = this.spot(actor, ['bin'], false); if (bin) return this.transfer(actor, item, bin, '清理焦糊食物'); }
      if (station.kind !== 'grill' && station.kind !== 'fryer') continue;
      if (item.kind === 'patty') {
        const base = this.publicItems(actor).find(i => (i.kind === 'bun' || i.kind === 'assembly') && burgerParts(i)?.includes('bun') && !burgerParts(i)?.includes('patty'));
        if (base) return this.transfer(actor, item, this.rules.station((base.location as { stationId: string }).stationId), '取出肉饼 · 组合汉堡', base.id);
      }
      const belt = isDish(item.kind) ? this.world.stations.find(s => s.conveyorIndex === 0 && !s.itemId && this.available(s, actor)) : undefined;
      const counter = belt ?? this.spot(actor, ['counter']); if (counter) return this.transfer(actor, item, counter, '及时取出' + ITEM_NAMES[item.kind]);
    }
    return null;
  }
  private burger(actor: KitchenActor, dish: 'burger' | 'cheeseburger', needed: number) {
    const items = this.publicItems(actor), targetCheese = dish === 'cheeseburger';
    const readyBurger = items.find(i => i.kind === 'burger');
    if (targetCheese && readyBurger) return this.job('加芝士 · 芝士牛肉堡', [this.supply('cheese'), this.put(this.rules.station((readyBurger.location as { stationId: string }).stationId), readyBurger.id)], 'cheeseburger');
    const base = items.find(i => (i.kind === 'bun' || i.kind === 'assembly') && burgerParts(i)?.includes('bun') && !burgerParts(i)?.includes('patty') && (targetCheese || !burgerParts(i)?.includes('cheese')));
    const cooked = items.find(i => i.kind === 'patty');
    if (base && cooked) return this.transfer(actor, cooked, this.rules.station((base.location as { stationId: string }).stationId), '组合' + DISH_NAMES[dish], base.id);
    const demand = this.orders(actor).slice(0, 3).flatMap(o => o.dishes);
    // Completed burgers are committed recipes, not spare patties for a different burger variant.
    const missingBurgers = (['burger', 'cheeseburger'] as const).reduce((total, kind) => total + Math.max(0, demand.filter(d => d === kind).length - this.count(kind)), 0);
    const cookedOrCooking = this.world.items.filter(i => ['patty', 'rawPatty'].includes(i.kind) || (i.kind === 'assembly' && i.ingredients.includes('patty'))).length + this.pending('patty');
    if (cookedOrCooking < missingBurgers) {
      const grill = this.spot(actor, ['grill']);
      const raw = items.find(i => i.kind === 'rawPatty');
      if (grill) return this.job('把肉饼送上煎台', [raw ? this.source(raw) : this.supply('rawPatty'), this.put(grill)], 'patty');
    }
    const bases = this.world.items.filter(i => i.kind === 'bun' || (i.kind === 'assembly' && i.ingredients.includes('bun'))).length + this.pending('bun');
    if (bases < needed) {
      const table = this.spot(actor, ['counter'], true, 'handoff');
      if (table) return this.job('准备面包 · 等肉饼', [this.supply('bun'), this.put(table)], 'bun');
    }
    return null;
  }
  private fried(actor: KitchenActor, dish: 'fries' | 'nuggets', needed: number) {
    const raw: ItemKind = dish === 'fries' ? 'potato' : 'rawChicken', cut: ItemKind = dish === 'fries' ? 'cutPotato' : 'cutChicken';
    const publicItems = this.publicItems(actor), ready = publicItems.find(i => i.kind === cut);
    const fryer = this.spot(actor, ['fryer']); if (!fryer) return null;
    if (ready) return this.job('把' + ITEM_NAMES[cut] + '送进炸锅', [this.source(ready), this.put(fryer)], dish);
    const existing = publicItems.find(i => i.kind === raw);
    if (!existing && this.count(raw) + this.count(cut) + this.count(dish) + this.pending(dish) >= needed) return null;
    const prep = existing?.location.type === 'station' && this.rules.station(existing.location.stationId).kind === 'chop' ? this.rules.station(existing.location.stationId) : this.spot(actor, ['chop']);
    if (!prep) return null;
    const steps: Step[] = existing && existing.location.type === 'station' && existing.location.stationId === prep.id ? [] : [existing ? this.source(existing) : this.supply(raw), this.put(prep)];
    steps.push({ stationId: prep.id, action: 'work', kind: raw, output: cut }, { stationId: prep.id, action: 'take', kind: cut }, this.put(fryer));
    return this.job('切配 → 炸制' + DISH_NAMES[dish], steps, dish);
  }
  private drink(actor: KitchenActor, needed: number) {
    if (this.count('cola') + this.count('cup') + this.pending('cola') >= needed) return null;
    const machine = this.spot(actor, ['drink']), table = this.spot(actor, ['counter'], true, 'assembly');
    if (!machine || !table) return null;
    return this.job('接一杯可乐', [this.supply('cup'), this.put(machine), { stationId: machine.id, action: 'work', kind: 'cup', output: 'cola' }, { stationId: machine.id, action: 'take', kind: 'cola' }, this.put(table)], 'cola');
  }
  private salvage(actor: KitchenActor) {
    const held = this.rules.item(actor.heldId); if (!held) return null;
    const orders = this.orders(actor);
    if (!this.playerPacksTutorial && ((isDish(held.kind) && orders.some(o => o.dishes.length === 1 && o.dishes[0] === held.kind)) || (held.kind === 'tray' && orders.some(o => sameDishes(o.dishes, this.trayDishes(held)))))) {
      const serve = this.deliveryWindow(actor, held); if (serve) return this.job('继续出餐', [{ stationId: serve.id, action: 'serve' }]);
    }
    if (!this.playerPacksTutorial && isDish(held.kind)) {
      const tray = this.publicItems(actor, ['tray']).find(t => t.contents.length < 3 && orders.some(o => dishSubset([...this.trayDishes(t), held.kind as Dish], o.dishes)));
      if (tray) return this.job('继续配齐套餐', [this.put(this.rules.station((tray.location as { stationId: string }).stationId), tray.id)]);
    }
    if (held.kind === 'patty') {
      const base = this.publicItems(actor, ['bun', 'assembly']).find(i => burgerParts(i)?.includes('bun') && !burgerParts(i)?.includes('patty'));
      if (base) return this.job('接上队友的汉堡', [this.put(this.rules.station((base.location as { stationId: string }).stationId), base.id)]);
    }
    const destination = held.kind === 'burnt' ? this.spot(actor, ['bin'], false) : held.kind === 'rawPatty' ? this.spot(actor, ['grill']) : ['cutPotato', 'cutChicken'].includes(held.kind) ? this.spot(actor, ['fryer']) : undefined;
    const table = destination ?? this.spot(actor, ['counter']);
    return table ? this.job('把' + ITEM_NAMES[held.kind] + '安全放好', [this.put(table)]) : null;
  }
  private plan(actor: KitchenActor): Job | null {
    if (actor.heldId) return this.salvage(actor);
    const orders = this.orders(actor); if (!orders.length) return null;
    const rescue = this.rescue(actor); if (rescue) return rescue;
    const pack = this.packing(actor, orders); if (pack) return pack;
    const demand = orders.slice(0, 3).flatMap(o => o.dishes), missing = demand.filter(d => this.count(d) < demand.filter(k => k === d).length);
    const dishes = [...new Set(missing)].sort((a, b) => {
      const preference = (d: Dish) => actor.role === 'drinks' ? d === 'cola' ? -1 : 0 : actor.role === 'hot' ? d === 'fries' || d === 'nuggets' ? -1 : 0 : actor.role === 'assembly' ? d === 'burger' || d === 'cheeseburger' ? -1 : 0 : 0;
      return preference(a) - preference(b);
    });
    for (const dish of dishes) {
      // In the final lesson AI prepares hot food; the player pours, packs and serves.
      if (this.playerPacksTutorial && dish === 'cola') continue;
      const need = demand.filter(d => d === dish).length;
      const job = dish === 'burger' || dish === 'cheeseburger' ? this.burger(actor, dish, need - this.count(dish)) : dish === 'cola' ? this.drink(actor, need) : this.fried(actor, dish, need);
      if (job) return job;
    }
    // An interrupted player pour remains usable instead of blocking the only machine.
    const machine = this.world.stations.find(s => s.kind === 'drink' && this.available(s, actor) && s.itemId);
    const item = machine && this.rules.item(machine.itemId), table = this.spot(actor, ['counter'], true, 'assembly');
    if (machine && item && table && !this.playerPacksTutorial) {
      if (item.kind === 'cola') return this.transfer(actor, item, table, '把可乐放到配餐台');
      if (item.kind === 'cup') return this.job('接完这杯可乐', [{ stationId: machine.id, action: 'work', kind: 'cup', output: 'cola' }, { stationId: machine.id, action: 'take', kind: 'cola' }, this.put(table)], 'cola');
    }
    return null;
  }
  private cancel(actor: KitchenActor) { const old = this.jobs.get(actor.id); if (old?.assistId === actor.assist?.id && actor.assist?.target.type !== 'order') this.assistStatus(actor, 'failed', '目标物品已被移动，已保留手中物品；可以重新派单'); this.jobs.delete(actor.id); this.retry.set(actor.id, this.world.tick + 15); actor.targetStationId = null; actor.job = '重新查看公共台面'; }
  private travel(actor: KitchenActor, station: KitchenStation, job: Job): boolean {
    let goal = center(station.ports[0]);
    if (this.world.actors.some(other => other.id !== actor.id && distance(other, goal) < .65)) {
      const stationCenter = center(station), normal = { x: goal.x - stationCenter.x, y: goal.y - stationCenter.y };
      const alternatives = [...[0, .15].flatMap(inset => [-.6, -.3, .3, .6].map(offset => ({ x: goal.x - normal.y * offset - normal.x * inset, y: goal.y + normal.x * offset - normal.y * inset }))), ...[{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }].map(offset => ({ x: stationCenter.x + offset.x, y: stationCenter.y + offset.y }))];
      // Grid routing must not re-enter an occupied goal tile merely because a small offset is free.
      const free = alternatives.filter(point => this.rules.navigation.canStand(point) && this.world.actors.every(other => other.id === actor.id || (distance(other, point) >= .52 && key(other) !== key(point))));
      free.sort((a, b) => distance(actor, a) - distance(actor, b) || a.x - b.x || a.y - b.y);
      if (free[0]) goal = free[0];
    }
    const destination = station.id + ':' + goal.x + ',' + goal.y;
    if (!job.detour && actor.trafficWait > 12) {
      const blocker = this.world.actors.find(a => a.id !== actor.id && distance(a, actor) < .85);
      if (blocker && (blocker.id === 'player' || actor.id > blocker.id)) {
        const origin = tile(actor), candidates = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].map(d => center({ x: origin.x + d.x, y: origin.y + d.y }));
        candidates.sort((a, b) => distance(b, blocker) - distance(a, blocker) || a.y - b.y || a.x - b.x);
        // A free destination is not enough: the yielding segment must not cross the blocking actor.
        job.detour = candidates.find(point => {
          const steps = Math.max(1, Math.ceil(distance(actor, point) / .12));
          for (let index = 1; index <= steps; index++) {
            const sample = { x: actor.x + (point.x - actor.x) * index / steps, y: actor.y + (point.y - actor.y) * index / steps };
            if (!this.rules.navigation.canStand(sample) || this.world.actors.some(other => other.id !== actor.id && distance(other, sample) < .49)) return false;
          }
          return true;
        });
        if (job.detour) job.detourAt = this.world.tick;
      }
    }
    if (job.detour && this.world.tick - (job.detourAt ?? this.world.tick) > 2 * HZ) { job.detour = undefined; job.path = []; job.destination = ''; job.blocked = 0; actor.trafficWait = 0; }
    if (job.detour) {
      const d = distance(actor, job.detour);
      if (d > .07) { this.rules.move(actor, (job.detour.x - actor.x) / d * Math.min(3.65 / HZ, d), (job.detour.y - actor.y) / d * Math.min(3.65 / HZ, d)); actor.job = job.label + ' · 让行'; return false; }
      job.detour = undefined; job.path = []; job.destination = ''; job.blocked = 0; actor.trafficWait = 0;
    }
    if (distance(actor, center(station)) < 1.26) { actor.facing = { x: center(station).x - actor.x, y: center(station).y - actor.y }; const n = Math.hypot(actor.facing.x, actor.facing.y); actor.facing.x /= n; actor.facing.y /= n; actor.trafficWait = 0; return true; }
    if (job.destination !== destination || !job.path.length || job.blocked === 18) {
      const occupied = new Set(this.world.actors.filter(a => a.id !== actor.id).map(key));
      job.path = this.rules.navigation.findPath(actor, goal, occupied); job.destination = destination;
      if (!job.path.length) job.path = this.rules.navigation.findPath(actor, goal);
    }
    const next = job.path[0]; if (!next) { job.blocked++; actor.state = 'waiting'; return false; }
    const d = distance(actor, next); if (d < .07) { job.path.shift(); return false; }
    const speed = 3.65 / HZ, before = { x: actor.x, y: actor.y };
    this.rules.move(actor, (next.x - actor.x) / d * Math.min(speed, d), (next.y - actor.y) / d * Math.min(speed, d));
    if (distance(before, actor) < .005) { job.blocked++; actor.trafficWait++; actor.state = 'waiting'; if (job.blocked > 45) { job.path = []; job.destination = ''; } }
    else { job.blocked = 0; actor.trafficWait = 0; }
    if (job.blocked > 120) this.cancel(actor);
    return false;
  }
  private run(actor: KitchenActor, job: Job) {
    const step = job.steps[job.index]; if (!step) { this.jobs.delete(actor.id); actor.targetStationId = null; return; }
    const movingId = step.action === 'take' ? step.itemId : step.action === 'put' ? step.occupied : undefined;
    const movingInput = movingId ? this.rules.item(movingId) : undefined;
    if (movingInput?.location.type === 'station' && movingInput.location.stationId !== step.stationId) {
      const before = this.rules.station(step.stationId), after = this.rules.station(movingInput.location.stationId);
      // A conveyor advances the same public item. Follow it; a hand pickup still invalidates the job below.
      if (before.conveyorId && before.conveyorId === after.conveyorId && (after.conveyorIndex ?? 0) > (before.conveyorIndex ?? 0)) {
        step.stationId = after.id; if (step.action === 'take') step.kind = movingInput.kind; job.destination = ''; job.path = []; job.blocked = 0;
        job.claims = [...new Set(job.steps.flatMap(s => [s.stationId, ...(s.itemId ? [s.itemId] : []), ...(s.occupied ? [s.occupied] : [])]))];
      }
    }
    const station = this.rules.station(step.stationId); actor.job = job.label; actor.targetStationId = station.id;
    if (this.protected(station)) { actor.state = 'waiting'; job.blocked++; if (job.blocked > 45) this.cancel(actor); return; }
    const item = this.rules.item(station.itemId), held = this.rules.item(actor.heldId);
    if (step.action === 'take' && (held || (step.itemId && item?.id !== step.itemId) || (station.kind !== 'supply' && station.kind !== 'traySupply' && item?.kind !== step.kind))) { this.cancel(actor); return; }
    if (step.action === 'put' && (!held || (step.occupied ? item?.id !== step.occupied : !!item))) { this.cancel(actor); return; }
    if (step.action === 'unpack' && (held || item?.id !== step.itemId || item?.kind !== 'tray' || this.rules.item(item.contents.at(-1) ?? null)?.kind !== step.kind)) { this.cancel(actor); return; }
    if (step.action === 'work' && (held || !item || ![step.kind, step.output].includes(item.kind))) { this.cancel(actor); return; }
    if (step.action === 'serve') {
      const dishes = held?.kind === 'tray' ? this.trayDishes(held) : held && isDish(held.kind) ? [held.kind] : [];
      // A teammate can fill the order while this actor is carrying its food.
      // An obsolete delivery is a new planning decision, not a player's wrong-order penalty.
      if (!held || !this.orders(actor).some(order => sameDishes(order.dishes, dishes) && (!station.channel || !order.channel || station.channel === order.channel))) { this.cancel(actor); return; }
    }
    if (!this.travel(actor, station, job)) return;
    let finished = false;
    if (step.action === 'unpack') finished = this.rules.work(actor, station);
    else if (step.action === 'work') { if (item!.kind === step.output) finished = true; else { this.rules.work(actor, station); finished = item!.kind === step.output; } }
    else finished = this.rules.interact(actor, station);
    if (!finished && step.action !== 'work') { this.cancel(actor); return; }
    if (finished) { job.index++; job.destination = ''; job.path = []; job.blocked = 0; if (job.index >= job.steps.length) { this.jobs.delete(actor.id); actor.targetStationId = null; if (job.assistId === actor.assist?.id && actor.assist?.target.type !== 'order') this.assistStatus(actor, 'completed', '接力完成，恢复原岗位'); } }
  }
  private yieldIdle(actor: KitchenActor) {
    const blocked = this.world.actors.find(other => other.id !== actor.id && other.trafficWait > 6 && distance(actor, other) < 1.1);
    if (!blocked) return;
    const origin = tile(actor), options = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }].map(d => center({ x: origin.x + d.x, y: origin.y + d.y })).sort((a, b) => distance(b, blocked) - distance(a, blocked));
    for (const p of options) { const path = this.rules.navigation.findPath(actor, p); if (path.length !== 1) continue; const n = distance(actor, p); if (this.rules.move(actor, (p.x - actor.x) / n * 3.65 / HZ, (p.y - actor.y) / n * 3.65 / HZ)) { actor.job = '给队友让出通道'; return; } }
  }
  private assistStatus(actor: KitchenActor, status: NonNullable<KitchenActor['assist']>['status'], message: string) {
    const assist = actor.assist; if (!assist || (assist.status === status && assist.message === message)) return;
    assist.status = status; assist.message = message; assist.updatedAt = this.world.tick;
    if (status === 'completed') this.world.mechanicProgress.assistsCompleted++;
    // Status lives in the snapshot; the engine emits the initial acknowledgement.
  }
  cancelAssist(actor: KitchenActor) {
    const instruction = actor.assist;
    if (!instruction || ['completed', 'cancelled', 'failed'].includes(instruction.status)) return;
    const job = this.jobs.get(actor.id);
    if (job?.assistId === instruction.id) { this.jobs.delete(actor.id); actor.targetStationId = null; this.retry.delete(actor.id); }
    this.assistStatus(actor, 'cancelled', '已取消，先安全放好手中物品');
  }
  private assistItem(actor: KitchenActor, item: KitchenItem): Job | null {
    if (item.location.type !== 'station') return null;
    const source = this.rules.station(item.location.stationId), process = PROCESS[item.kind];
    if (!this.available(source, actor)) return null;
    if (source.state === 'cooking') return null;
    if (item.kind === 'burnt') { const bin = this.spot(actor, ['bin'], false); return bin ? this.transfer(actor, item, bin, '帮忙清理焦糊食物') : null; }
    if (process) {
      const destination = process.station === source.kind ? source : this.spot(actor, [process.station]);
      if (!destination) return null;
      const steps: Step[] = source.id === destination.id ? [] : [this.source(item), this.put(destination)];
      if (process.station === 'chop' || process.station === 'drink') {
        steps.push({ stationId: destination.id, action: 'work', kind: item.kind, output: process.output });
        const next = process.station === 'chop' ? this.spot(actor, ['fryer']) : this.spot(actor, ['counter'], true, 'assembly');
        if (next) steps.push({ stationId: destination.id, action: 'take', kind: process.output }, this.put(next));
      }
      return steps.length ? this.job('接续' + ITEM_NAMES[item.kind], steps, process.output) : null;
    }
    if (isDish(item.kind) || item.kind === 'tray') {
      const deliver = this.deliver(actor, item); if (deliver) return deliver;
      const tray = isDish(item.kind) ? this.publicItems(actor, ['tray']).find(t => t.contents.length < 3 && this.orders(actor).some(o => dishSubset([...this.trayDishes(t), item.kind as Dish], o.dishes))) : undefined;
      if (tray?.location.type === 'station') return this.transfer(actor, item, this.rules.station(tray.location.stationId), '接续配齐套餐', tray.id);
    }
    if (item.kind === 'patty') {
      const base = this.publicItems(actor, ['bun', 'assembly']).find(i => burgerParts(i)?.includes('bun') && !burgerParts(i)?.includes('patty'));
      if (base?.location.type === 'station') return this.transfer(actor, item, this.rules.station(base.location.stationId), '接续组合汉堡', base.id);
    }
    if (item.kind === 'bun' || item.kind === 'assembly') {
      const patty = this.publicItems(actor, ['patty']).find(i => i.id !== item.id);
      if (patty) return this.transfer(actor, patty, source, '接续组合汉堡', item.id);
    }
    const table = this.spot(actor, ['counter'], true, 'assembly');
    return table ? this.transfer(actor, item, table, '把' + ITEM_NAMES[item.kind] + '接到配餐区') : null;
  }
  private assistPlan(actor: KitchenActor): Job | null {
    const assist = actor.assist; if (!assist || ['completed', 'failed', 'cancelled'].includes(assist.status)) return null;
    const target = assist.target;
    if (target.type === 'order') {
      const order = this.world.orders.find(o => o.id === target.id);
      if (!order || order.status === 'missed') { this.assistStatus(actor, 'failed', '这份订单已经结束'); return null; }
      if (order.status === 'served') { this.assistStatus(actor, 'completed', '指定订单已经交付，恢复原岗位'); return null; }
      if (order.status === 'forecast') { this.assistStatus(actor, 'waiting', '等待这份订单到来'); return null; }
      this.assistStatus(actor, 'executing', '优先料理 #' + order.id);
      return this.plan(actor);
    }
    const station = target.type === 'station' ? this.rules.station(target.id) : undefined;
    const item = target.type === 'item' ? this.rules.item(target.id) : this.rules.item(station?.itemId ?? null);
    if (target.type === 'item' && !item) { this.assistStatus(actor, 'failed', '食物已被交付或组合，请选择新的目标'); return null; }
    if (item?.location.type === 'hand' || item?.location.type === 'air' || item?.location.type === 'ground' || item?.location.type === 'tray') { this.assistStatus(actor, 'waiting', '请把这份食物放到公共台面，伙伴就会接手'); return null; }
    let job = item ? this.assistItem(actor, item) : null;
    if (!item && station) {
      // A station request means one useful production task there, not permanent reassignment.
      const demand = this.orders(actor).slice(0, 3).flatMap(o => o.dishes);
      if (station.kind === 'drink' && demand.includes('cola')) job = this.drink(actor, demand.filter(d => d === 'cola').length);
      else if (station.kind === 'chop' || station.kind === 'fryer') { const dish = demand.find(d => d === 'fries' || d === 'nuggets'); if (dish === 'fries' || dish === 'nuggets') job = this.fried(actor, dish, demand.filter(d => d === dish).length); }
      else if (station.kind === 'grill') { const dish = demand.find(d => d === 'burger' || d === 'cheeseburger'); if (dish === 'burger' || dish === 'cheeseburger') job = this.burger(actor, dish, 1); }
      else if (station.kind === 'counter' || station.kind === 'serve') job = this.packing(actor, this.orders(actor));
      if (!job && !demand.length) { this.assistStatus(actor, 'completed', '这里暂时没有待处理订单，恢复原岗位'); return null; }
    }
    if (job) this.assistStatus(actor, 'executing', job.label);
    else this.assistStatus(actor, 'waiting', item ? '等待设备完成或台面空位' : '等待这个工位有可处理的工作');
    return job;
  }
  finishShift() {
    for (const actor of this.world.actors) {
      const instruction = actor.assist;
      if (!instruction || ['completed', 'failed', 'cancelled'].includes(instruction.status)) continue;
      const delivered = instruction.target.type === 'order' && this.world.orders.find(o => o.id === instruction.target.id)?.status === 'served';
      this.assistStatus(actor, delivered ? 'completed' : 'failed', delivered ? '指定订单已经交付' : '班次已结束，指令未完成');
    }
  }
  step(enabled: boolean) {
    for (const actor of this.world.actors.filter(a => a.id !== 'player').sort((a, b) => Number(!!b.assist && ['received', 'waiting', 'executing'].includes(b.assist.status)) - Number(!!a.assist && ['received', 'waiting', 'executing'].includes(a.assist.status)) || a.id.localeCompare(b.id))) {
      if (!enabled || this.world.phase === 'prep' || this.world.tutorial?.stage === 'burger') { actor.job = '等你准备好'; this.yieldIdle(actor); continue; }
      let job = this.jobs.get(actor.id);
      const assist = actor.assist;
      if (assist && !['completed', 'cancelled', 'failed'].includes(assist.status) && assist.target.type === 'order' && this.world.orders.find(o => o.id === assist.target.id)?.status === 'served') this.assistStatus(actor, 'completed', '指定订单已经交付，恢复原岗位');
      const active = assist && !['completed', 'cancelled', 'failed'].includes(assist.status);
      if (active && job?.assistId !== assist.id) {
        if (actor.heldId) this.assistStatus(actor, 'waiting', '先放好手中食物，再执行指令');
        else { this.jobs.delete(actor.id); job = undefined; this.retry.delete(actor.id); }
      }
      if (!job && (this.retry.get(actor.id) ?? 0) <= this.world.tick) {
        if (active && !actor.heldId) { job = this.assistPlan(actor) ?? undefined; if (job) job.assistId = assist.id; }
        else job = this.plan(actor) ?? undefined;
        if (job) this.jobs.set(actor.id, job);
      }
      if (job) this.run(actor, job);
      else { actor.targetStationId = null; actor.job = actor.heldId ? '等一处空台面' : '查看订单 · 等队友交接'; this.yieldIdle(actor); }
    }
  }
}
