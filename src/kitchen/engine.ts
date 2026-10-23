import { KitchenAI } from './ai';
import { center, createNavigation, makeStations } from './map';
import { getLevel } from './levels';
import { evaluateShift } from './rating';
import { makeOrders } from './orders';
import { burgerParts, DISH_NAMES, isDish, ITEM_NAMES, sameDishes } from './recipes';
import { KitchenRules } from './rules';
import { HZ, RULES_VERSION, type LevelDefinition, type ReadonlyKitchenSnapshot, type ActorId, type Dish, type KitchenActor, type KitchenCommand, type KitchenEvent, type KitchenGuide, type KitchenOptions, type KitchenSnapshot, type KitchenStation, type Point } from './types';

const metrics = (): KitchenSnapshot['metrics'] => ({ served: 0, onTime: 0, missed: 0, mistakes: 0, score: 0, combo: 0, bestCombo: 0, handoffs: 0, burnt: 0, averageWait: null, contributions: { player: 0, a: 0, b: 0 } });
const actors = (level: LevelDefinition): KitchenActor[] => (['player', 'a', 'b'] as const).map((id, i) => ({ id, name: ['你', 'Mika', 'Jin'][i], ...level.spawns[id], facing: { x: 0, y: -1 }, heldId: null, role: i === 1 ? 'hot' : i === 2 ? 'assembly' : 'auto', state: 'idle', job: i ? '等你准备好' : '亲手料理', targetStationId: null, workProgress: 0, stamina: 1, dash: false, assist: null, completedActions: 0, deliveries: 0, trafficWait: 0, throwCharge: 0 }));
const tutorialOrder = (id: string, dishes: Dish[]): KitchenSnapshot['orders'][number] => ({ id, dishes, arrival: 0, due: 9999999, status: 'active', servedAt: null, servedBy: null, points: 0 });
/** Fixed-step authority. Rendering gets copies; only commands and physical AI actions change this world. */
export class KitchenEngine {
  readonly level: LevelDefinition;
  readonly navigation: ReturnType<typeof createNavigation>;
  private world: KitchenSnapshot;
  private rules: KitchenRules;
  private ai: KitchenAI;
  private readonly options: KitchenOptions;
  private input = { x: 0, y: 0, work: false, dash: false, throwing: false };
  private seq = 0;
  private frame = 0;
  private currentEvents: KitchenEvent[] = [];
  private log: { tick: number; command: KitchenCommand }[] = [];
  private handedOff = false;
  private handoffItemId: string | null = null;
  private handoffInstructionCompleted = false;
  private tutorialCola = false;
  private assistSeq = 0;
  private announcedWaves = new Set<string>();
  constructor(options: KitchenOptions = {}) {
    this.level = getLevel(options.levelId); this.navigation = createNavigation(this.level);
    this.options = { seed: 1024, levelId: this.level.id, tutorial: true, ai: true, prepSeconds: this.level.prepSeconds, serviceSeconds: this.level.serviceSeconds, closingSeconds: this.level.closingSeconds, ...structuredClone(options) };
    this.world = this.freshWorld(!!this.options.tutorial);
    this.rules = new KitchenRules(this.world, event => this.emit(event)); this.ai = new KitchenAI(this.rules);
  }
  private freshWorld(tutorial: boolean): KitchenSnapshot {
    return { rulesVersion: RULES_VERSION, levelId: this.level.id, seed: this.options.seed!, tick: 0, serviceTick: 0, phase: tutorial ? 'tutorial' : this.options.prepSeconds! > 0 ? 'prep' : 'service', phaseRemaining: tutorial ? 0 : Math.round((this.options.prepSeconds! > 0 ? this.options.prepSeconds! : this.options.serviceSeconds!) * HZ), actors: actors(this.level), stations: makeStations(this.level.stations), items: [], orders: tutorial ? [{ ...tutorialOrder('练习1', this.level.mechanic === 'handoff' ? ['burger'] : ['cola']), ...(this.level.mechanic === 'windows' ? { channel: 'dine-in' as const } : {}) }] : makeOrders(this.options), metrics: metrics(), priorityOrderId: null, tutorial: tutorial ? this.level.mechanic === 'conveyor' ? { stage: 'conveyor', step: 1, total: 3, title: '把可乐送上传餐带', text: '接一杯可乐，放在传餐带最左端；等它向右移动，再从末端接走出餐。满载时会停住，旁边始终可以绕行。', targetStationId: 'cups' } : this.level.mechanic === 'windows' ? { stage: 'windows', step: 1, total: 2, title: '认准堂食窗口', text: '接一杯可乐，送到左侧堂食窗口；订单卡会明确标出窗口。', targetStationId: 'cups' } : { stage: 'burger', step: 1, total: 3, title: '1 · 亲手做一份牛肉堡', text: '拿生肉饼放到煎台；趁它烹饪拿面包放在台面上，再把熟肉饼叠上去。', targetStationId: 'meat' } : null, hint: 'WASD 移动 · E 取放 · 按住 Space 切配/接饮', events: [], wave: null, mechanicProgress: { conveyorTransfers: 0, playerConveyorLoads: 0, playerConveyorRetrievals: 0, correctWindowServes: 0, assistsCompleted: 0 }, shiftRating: null };
  }
  get commandLog(): readonly { tick: number; command: KitchenCommand }[] { return structuredClone(this.log); }
  getSnapshot(): KitchenSnapshot { return structuredClone(this.world); }
  /** Borrowed deep-readonly view. Valid for the current frame; use getSnapshot for a retained record. */
  readSnapshot(): ReadonlyKitchenSnapshot { return this.world; }
  getInteractionPreview(actorId: ActorId = 'player') { return structuredClone(this.rules.preview(this.rules.actor(actorId))); }
  private emit(event: Omit<KitchenEvent, 'seq' | 'tick'>) {
    const entry: KitchenEvent = { ...event, seq: ++this.seq, tick: this.world.tick };
    this.currentEvents.push(entry); this.world.events.push(entry); if (this.world.events.length > 180) this.world.events.shift();
    if (event.type === 'ready' && event.actorId === 'player' && event.itemId && this.rules?.item(event.itemId)?.kind === 'cola') this.tutorialCola = true;
    if (event.type === 'serve') { if (this.world.priorityOrderId === event.orderId) this.world.priorityOrderId = null; this.world.hint = event.message; }
  }
  private beginService() { this.world.phase = 'service'; this.world.phaseRemaining = Math.round(this.options.serviceSeconds! * HZ); this.emit({ type: 'phase', message: this.level.name + ' · 开始接单' }); }
  private finishTutorial() {
    const roles = this.world.actors.map(a => a.role);
    this.world = this.freshWorld(false); this.world.actors.forEach((a, i) => { a.role = roles[i]; });
    this.rules = new KitchenRules(this.world, event => this.emit(event)); this.ai = new KitchenAI(this.rules);
    this.input = { x: 0, y: 0, work: false, dash: false, throwing: false }; this.emit({ type: 'phase', message: '练习完成 · 准备营业' });
  }
  private command(command: KitchenCommand) {
    const player = this.rules.actor('player');
    switch (command.type) {
      case 'move': this.input.x = Number.isFinite(command.x) ? Math.max(-1, Math.min(1, command.x)) : 0; this.input.y = Number.isFinite(command.y) ? Math.max(-1, Math.min(1, command.y)) : 0; break;
      case 'dash': this.input.dash = command.held; break;
      case 'work': this.input.work = command.held; break;
      case 'throw':
        if (command.cancel) { this.input.throwing = false; player.throwCharge = 0; }
        else if (command.held) this.input.throwing = true;
        else if (this.input.throwing) { this.rules.throw(player); this.input.throwing = false; }
        break;
      case 'interact': this.rules.interact(player); break;
      case 'role': {
        const actor = this.rules.actor(command.actorId); actor.role = command.role; this.emit({ type: 'role', actorId: actor.id, message: actor.name + '已调整岗位，放好当前物品后接新任务' }); break;
      }
      case 'priority': this.world.priorityOrderId = this.world.orders.some(o => o.id === command.orderId && (o.status === 'active' || o.status === 'late')) ? command.orderId : null; this.emit({ type: 'priority', orderId: this.world.priorityOrderId ?? undefined, message: this.world.priorityOrderId ? '#' + this.world.priorityOrderId + ' 已加急' : '恢复按到单顺序料理' }); break;
      case 'assist': {
        const actor = this.rules.actor(command.actorId), target = command.target;
        if (actor.assist && ['received', 'waiting', 'executing'].includes(actor.assist.status) && actor.assist.target.type === target.type && actor.assist.target.id === target.id) break;
        const targetStation = target.type === 'station' ? this.rules.station(target.id) : undefined;
        const valid = target.type === 'item' ? !!this.rules.item(target.id) : target.type === 'station' ? !!targetStation && !['supply', 'traySupply', 'bin'].includes(targetStation.kind) : this.world.orders.some(o => o.id === target.id && ['active', 'late', 'forecast'].includes(o.status));
        this.ai.cancelAssist(actor);
        actor.assist = { id: ++this.assistSeq, target: { ...target }, status: valid ? 'received' : 'failed', message: valid ? '收到，放好当前物品后接力' : targetStation ? '请选择加工台、交接台、配餐台或出餐窗口' : '目标已离开厨房，请重新选择', issuedAt: this.world.tick, updatedAt: this.world.tick };
        this.emit({ type: 'assist', actorId: actor.id, message: actor.name + '：' + actor.assist.message }); break;
      }
      case 'assist-cancel': {
        const actor = this.rules.actor(command.actorId); this.ai.cancelAssist(actor); break;
      }
      case 'tutorial-skip': if (this.world.phase === 'tutorial') this.finishTutorial(); break;
    }
  }
  private tutorial() {
    const tutorial = this.world.tutorial; if (!tutorial) return;
    if (tutorial.stage === 'conveyor') {
      const progress = this.world.mechanicProgress;
      if (progress.playerConveyorLoads) { tutorial.step = progress.playerConveyorRetrievals ? 3 : 2; tutorial.title = tutorial.step === 2 ? '等可乐到末端，接走它' : '拿可乐到下方出餐口'; }
      if (progress.playerConveyorLoads && progress.conveyorTransfers >= 3 && progress.playerConveyorRetrievals && this.world.orders[0]?.status === 'served') this.finishTutorial();
      return;
    }
    if (tutorial.stage === 'windows') {
      if (this.world.orders[0]?.status === 'served') {
        if (tutorial.step === 2) this.finishTutorial();
        else { tutorial.step = 2; tutorial.title = '再接一杯，送外带窗口'; tutorial.text = '这次订单标记外带，要送到右侧窗口。高峰转移时也可以指挥伙伴优先完成指定订单。'; this.world.orders = [{ ...tutorialOrder('练习2', ['cola']), channel: 'takeaway' }]; }
      }
      return;
    }
    if (tutorial.stage === 'burger' && this.world.orders[0]?.status === 'served') {
      tutorial.stage = 'handoff'; tutorial.step = 2; tutorial.title = '2 · 把准备工作交给队友'; tutorial.text = '土豆放到切配台，按住 Space；切好后放中央交接台，面对它按 Q → 1 → E，指挥 Mika 接续这份食物。'; tutorial.targetStationId = 'potato';
      this.world.orders = [tutorialOrder('练习2', ['fries'])]; this.emit({ type: 'tutorial', message: tutorial.title });
    }
    if (tutorial.stage === 'handoff') {
      if (this.world.actors.some(actor => actor.assist?.target.type === 'item' && actor.assist.target.id === this.handoffItemId && actor.assist.status === 'completed')) this.handoffInstructionCompleted = true;
      if (!this.handedOff) {
        const prepared = this.world.items.find(i => i.kind === 'cutPotato' && i.lastHandledBy === 'player' && i.location.type === 'station' && this.rules.station(i.location.stationId).zone === 'handoff');
        if (prepared) { this.handedOff = true; this.handoffItemId = prepared.id; }
      }
      if (this.handedOff && this.handoffInstructionCompleted && this.world.orders[0]?.status === 'served') {
        tutorial.stage = 'combo'; tutorial.step = 3; tutorial.title = '3 · 配齐一份套餐'; tutorial.text = '队友会做好汉堡和薯条。你先取餐盒放在空台面，再接一杯可乐；把三样餐品逐件装入，最后拿整盒到出餐口。'; tutorial.targetStationId = 'trays';
        this.world.orders = [tutorialOrder('练习3', ['burger', 'fries', 'cola'])]; this.emit({ type: 'tutorial', message: tutorial.title });
      } else if (this.handoffItemId && !this.rules.item(this.handoffItemId)) {
        // Discarding or manually serving the lesson item cannot strand the teaching flow.
        this.handedOff = false; this.handoffItemId = null; this.handoffInstructionCompleted = false;
        if (this.world.orders[0]?.status === 'served') this.world.orders = [tutorialOrder('练习2', ['fries'])];
      }
    }
    if (tutorial.stage === 'combo' && this.tutorialCola && this.world.orders[0]?.status === 'served' && this.world.orders[0].servedBy === 'player') this.finishTutorial();
  }
  private clock() {
    if (this.world.phase === 'tutorial') { this.tutorial(); return; }
    if (this.world.phase === 'prep') { if (--this.world.phaseRemaining <= 0) this.beginService(); return; }
    if (this.world.phase !== 'service' && this.world.phase !== 'closing') return;
    for (const order of this.world.orders) {
      if (order.status === 'forecast' && order.arrival <= this.world.serviceTick) { order.status = 'active'; this.emit({ type: 'order', orderId: order.id, message: '#' + order.id + ' 新订单 · ' + order.dishes.map(d => DISH_NAMES[d]).join(' + ') }); }
      if (order.status === 'active' && this.world.serviceTick > order.due) { order.status = 'late'; this.world.metrics.combo = 0; this.emit({ type: 'order', orderId: order.id, message: '#' + order.id + ' 已超时 · 仍可交付，失去准时奖励' }); }
    }
    const nextWave = this.level.waves.find(wave => wave.arrival * HZ * this.options.serviceSeconds! / this.level.serviceSeconds > this.world.serviceTick);
    this.world.wave = nextWave ? { id: nextWave.id, label: nextWave.label, startsIn: Math.ceil(nextWave.arrival * HZ * this.options.serviceSeconds! / this.level.serviceSeconds - this.world.serviceTick), channel: nextWave.channel } : null;
    if (this.world.wave && this.world.wave.startsIn <= 15 * HZ && !this.announcedWaves.has(this.world.wave.id)) {
      this.announcedWaves.add(this.world.wave.id); this.emit({ type: 'wave', message: '15 秒内：' + this.world.wave.label });
    }
    this.world.serviceTick++; this.world.phaseRemaining--;
    if (this.world.phase === 'service' && this.world.phaseRemaining <= 0) { this.world.phase = 'closing'; this.world.phaseRemaining = Math.round(this.options.closingSeconds! * HZ); this.emit({ type: 'phase', message: '停止接新单 · 把手中的订单收好尾' }); }
    if (this.world.phase === 'closing' && (this.world.phaseRemaining <= 0 || this.world.orders.every(o => o.status === 'served' || o.status === 'missed'))) {
      for (const order of this.world.orders) if (order.status !== 'served') { order.status = 'missed'; this.world.metrics.missed++; }
      this.world.phase = 'results'; this.world.phaseRemaining = 0; this.world.shiftRating = evaluateShift(this.world); this.ai.finishShift(); this.emit({ type: 'phase', message: '营业结束 · 今天辛苦了' });
    }
  }
  step(commands: readonly KitchenCommand[] = []): KitchenEvent[] {
    if (this.world.phase === 'results') return [];
    this.currentEvents = []; this.frame++; this.world.tick++; this.rules.beginTick();
    for (const command of commands) { this.log.push({ tick: this.frame, command: structuredClone(command) }); this.command(command); }
    const player = this.rules.actor('player'), norm = Math.hypot(this.input.x, this.input.y);
    if (norm > 0) {
      const dash = this.input.dash && player.stamina > .06; player.dash = dash;
      const speed = (dash ? 6 : 3.8) / HZ; const moved = this.rules.move(player, this.input.x / norm * speed, this.input.y / norm * speed);
      player.trafficWait = moved ? 0 : player.trafficWait + 1; player.stamina = Math.max(0, player.stamina - (dash ? .42 / HZ : 0));
    } else player.trafficWait = 0;
    if (!player.dash) player.stamina = Math.min(1, player.stamina + .28 / HZ);
    if (this.input.throwing) player.throwCharge = Math.min(1, player.throwCharge + 1 / (HZ * .7));
    const candidate = this.rules.target(player)?.station;
    // Player has priority over reservations while facing a nearby station, including holding an input.
    player.targetStationId = candidate && (this.input.work || !!player.heldId) ? candidate.id : null;
    if (this.input.work && !this.input.throwing) this.rules.work(player);
    this.rules.machines(); this.rules.flights(); this.rules.conveyors();
    const activeHandoffInstruction = this.world.actors.some(actor => actor.assist?.target.type === 'item' && actor.assist.target.id === this.handoffItemId && ['received', 'waiting', 'executing', 'completed'].includes(actor.assist.status));
    const tutorialAllowed = !this.world.tutorial || this.world.tutorial.stage === 'combo' || (this.world.tutorial.stage === 'handoff' && this.handedOff && (activeHandoffInstruction || this.handoffInstructionCompleted || this.world.actors.some(actor => actor.id !== 'player' && actor.heldId === this.handoffItemId)));
    this.ai.step(!!this.options.ai && tutorialAllowed); this.clock();
    if (this.world.tutorial) { const guide = this.getGuide(); this.world.tutorial.targetStationId = guide.stationId; }
    return structuredClone(this.currentEvents);
  }
  getGuide(): KitchenGuide {
    const player = this.rules.actor('player'), held = this.rules.item(player.heldId), preview = this.rules.preview(player), tutorial = this.world.tutorial;
    const station = (id: string) => this.rules.station(id);
    const firstEmpty = (kind: KitchenStation['kind']) => this.world.stations.find(s => s.kind === kind && !s.itemId);
    const answer = (title: string, text: string, target?: KitchenStation): KitchenGuide => ({ title, text, stationId: target?.id ?? null, position: target ? center(target) : null });
    if (this.world.phase === 'results') return answer('营业结束', '看一看今天的合作成绩，再挑战一次。');
    if (this.world.phase === 'prep') return answer('准备开工', '左侧煎炸，上方取料和切配；中央台面交接，右侧配餐，下面出餐。');
    if (tutorial?.stage === 'conveyor') {
      const progress = this.world.mechanicProgress, conveyor = this.level.conveyors[0];
      const food = this.world.items.find(item => item.kind === 'cup' || item.kind === 'cola');
      if (held?.kind === 'cola') return progress.playerConveyorRetrievals && held.conveyorJourney?.entryIndex === 0 && held.conveyorJourney.steps >= conveyor.stationIds.length - 1 ? answer('传餐完成，送去出餐', '到下方出餐口按 E。你已学会让传餐带替你跑一段路。', station('serve-a')) : answer('可乐放到最左端', '面向带箭头的第一个传餐位按 E；四个缓冲位满时会停，不会吞掉食物。', station(conveyor.stationIds[0]));
      if (!held && !food) return answer('先接一杯可乐', '右上角拿杯，放到可乐机，再按住 Space 接满。', station('cups'));
      if (!held && food?.location.type === 'ground') return { title: '捡回这杯饮料', text: '靠近按 E 拿起，再从传餐带最左端送过去。', stationId: null, position: { x: food.location.x, y: food.location.y } };
      if (!held && food?.location.type === 'station' && station(food.location.stationId).conveyorId) return answer('到右端接取可乐', '沿通道走到最右端，等可乐到达后按 E 接走。也可以始终走侧边绕行。', station(conveyor.stationIds.at(-1)!));
      if (!held && food?.location.type === 'station' && food.kind === 'cola') return answer('拿起这杯可乐', '按 E 拿起，再从传餐带最左端送过去。', station(food.location.stationId));
    }
    if (tutorial?.stage === 'windows') {
      if (held?.kind === 'cola') return answer(tutorial.step === 1 ? '送到左侧堂食窗口' : '送到右侧外带窗口', '看订单卡的窗口标记，再按 E 出餐。走错窗口会提醒你，餐品仍在手中。', station(tutorial.step === 1 ? 'serve-a' : 'serve-b'));
      if (!held && !this.world.items.some(i => i.kind === 'cup' || i.kind === 'cola')) return answer(tutorial.title, tutorial.text, station('cups'));
    }
    if (tutorial?.stage === 'combo') {
      const desired = this.world.orders[0].dishes;
      const tray = this.world.items.find(i => i.kind === 'tray');
      const trayStation = tray?.location.type === 'station' ? station(tray.location.stationId) : undefined;
      const contents = tray?.contents.map(id => this.rules.item(id)!.kind).filter(isDish) ?? [];
      const remaining = [...desired]; for (const dish of contents) { const index = remaining.indexOf(dish); if (index >= 0) remaining.splice(index, 1); }
      const emptyTable = this.world.stations.find(s => s.kind === 'counter' && s.zone === 'assembly' && !s.itemId) ?? firstEmpty('counter');
      if (held?.kind === 'tray') {
        if (sameDishes(held.contents.map(id => this.rules.item(id)!.kind).filter(isDish), desired)) return answer('拿整盒出餐', '牛肉堡、薯条、可乐都齐了。你亲自把餐盒带到下方出餐口，按 E。', station('serve-a'));
        return answer('把餐盒放到空台面', '先按 E 放下餐盒，空出双手，再把三样餐品逐件拿来装入。', emptyTable);
      }
      if (held && isDish(held.kind)) {
        if (trayStation) return answer('把' + ITEM_NAMES[held.kind] + '装进餐盒', '面向餐盒按 E；放好后，再去拿下一样餐品。', trayStation);
        return answer('先把餐品暂放台面', '先按 E 放下餐品，再到右上角拿餐盒，放到另一处空台面。', emptyTable);
      }
      if (!held) {
        if (!tray) return answer('先拿一个餐盒', '到右上角餐盒架按 E；队友会把汉堡和薯条做好，装盒和出餐由你来。', station('trays'));
        if (tray.location.type === 'ground') return { title: '捡起餐盒，放到台面', text: '靠近餐盒按 E 拿起，再放到空台面，便于逐件装入餐品。', stationId: null, position: { x: tray.location.x, y: tray.location.y } };
        if (trayStation) {
          if (sameDishes(contents, desired)) return answer('拿起整份套餐', '三样已齐。面向餐盒按 E 拿起，再带到下方出餐口。', trayStation);
          const meal = this.world.items.find(i => isDish(i.kind) && remaining.includes(i.kind) && i.location.type === 'station');
          if (meal?.location.type === 'station') return answer('拿起' + ITEM_NAMES[meal.kind], '按 E 拿起，带到餐盒再按 E 装入；目前还差' + remaining.map(d => DISH_NAMES[d]).join('、') + '。', station(meal.location.stationId));
          if (remaining.includes('cola')) {
            const cup = this.world.items.find(i => i.kind === 'cup' && i.location.type === 'station');
            if (cup?.location.type === 'station') {
              const cupStation = station(cup.location.stationId);
              return cupStation.kind === 'drink' ? answer('接满这杯可乐', '面向可乐机按住 Space，接满后按 E 拿起，再放入餐盒。', cupStation) : answer('把纸杯拿到可乐机', '先按 E 拿起纸杯，再放到可乐机接饮。', cupStation);
            }
            return answer('拿纸杯，准备可乐', '右上角 E 拿空杯，放到可乐机后按住 Space；接满再装入餐盒。', station('cups'));
          }
          return answer('等队友做好下一样', '还差' + remaining.map(d => DISH_NAMES[d]).join('、') + '。餐品做好后，拿来逐件装入；队友会把装盒和出餐留给你。');
        }
      }
    }
    if (held) {
      if (held.kind === 'burnt') return answer('清理焦糊食物', '带到回收桶按 E，再做新的一份。', station('bin'));
      if (held.kind === 'rawPatty') return answer('把肉饼放上煎台', 'E 放下后会自动烹饪，可以去准备面包；绿色后及时取走。', firstEmpty('grill'));
      if (held.kind === 'potato' || held.kind === 'rawChicken') return answer('先切配', '放到上方切配台，再空手按住 Space。', firstEmpty('chop'));
      if (held.kind === 'cutPotato' || held.kind === 'cutChicken') {
        if (tutorial?.stage === 'handoff' && !this.handedOff) return answer('交给队友接力', '把切好的薯条放到中央交接台，队友会接着炸制。', this.world.stations.find(s => s.zone === 'handoff' && !s.itemId));
        return answer('放进炸锅', 'E 放下后会自动炸制，完成后及时取走。', firstEmpty('fryer'));
      }
      if (held.kind === 'cup') return answer('接一杯可乐', 'E 放下纸杯，再空手按住 Space 接饮。', station('drink'));
      if (held.kind === 'bun' || held.kind === 'patty' || held.kind === 'cheese' || held.kind === 'assembly') {
        const base = this.world.items.find(i => i.location.type === 'station' && burgerParts(i) && burgerParts(i)!.every(p => !burgerParts(held)?.includes(p)) && this.rules.station(i.location.stationId).kind === 'counter');
        return answer('组合汉堡', '面包 + 熟肉饼是经典牛肉堡，再加芝士就是芝士堡；顺序不限。', base?.location.type === 'station' ? station(base.location.stationId) : firstEmpty('counter'));
      }
      const dishes = held.kind === 'tray' ? held.contents.map(id => this.rules.item(id)!.kind).filter(isDish) : isDish(held.kind) ? [held.kind] : [];
      const matchedOrder = this.world.orders.find(o => ['active', 'late'].includes(o.status) && sameDishes(o.dishes, dishes));
      if (matchedOrder) { const window = this.world.stations.find(s => s.kind === 'serve' && (!s.channel || !matchedOrder.channel || s.channel === matchedOrder.channel)); return answer('可以出餐了', '带到' + (window?.label ?? '出餐口') + '按 E；只有完全匹配的组合才会交付。', window); }
      if (held.kind === 'tray') return answer('配齐套餐', '把餐盒放到空台面，再逐件放入餐品；空手按 Space 可取出最后一件。', firstEmpty('counter'));
      const tray = this.world.items.find(i => i.kind === 'tray' && i.location.type === 'station' && i.contents.length < 3);
      return answer('把餐品装进套餐', '拿着餐品对餐盒按 E；没有餐盒时，先放在台面暂存。', tray?.location.type === 'station' ? station(tray.location.stationId) : firstEmpty('counter'));
    }
    if (preview?.workLabel) return answer('继续加工', preview.workLabel, preview.stationId ? station(preview.stationId) : undefined);
    const ready = this.world.stations.find(s => (s.kind === 'grill' || s.kind === 'fryer') && s.state === 'ready');
    if (ready) return answer('及时取出成品', '绿色已熟，红色倒计时结束会焦；空手 E 取出。', ready);
    if (tutorial?.stage === 'handoff') {
      if (this.handedOff) {
        const instruction = this.world.actors.find(actor => actor.assist?.target.type === 'item' && actor.assist.target.id === this.handoffItemId)?.assist;
        if (!instruction || ['cancelled', 'failed'].includes(instruction.status)) {
          const food = this.rules.item(this.handoffItemId);
          if (food?.location.type === 'hand' && food.location.actorId !== 'player') return answer('伙伴先把食物放好', '取消指令后，伙伴会先安全放下手中的食物。放好后，面对它重新按 Q → 1 → E。');
          return answer('现在指挥一次接力', '面对这份食物按 Q → 1 → E，让 Mika 接续。收到指令后，伙伴才会开始；取消后可以重新派单。', food?.location.type === 'station' ? station(food.location.stationId) : undefined);
        }
        return answer('伙伴收到你的指令', '看看它怎样接手、送进炸锅并出餐；指令完成后，伙伴会恢复原岗位。');
      }
      const cut = this.world.items.find(i => i.kind === 'cutPotato' && i.location.type === 'station');
      if (cut?.location.type === 'station') return answer('拿去中央交接台', 'E 取走切好的薯条，再放到中央台面。', station(cut.location.stationId));
      return answer(tutorial.title, tutorial.text, station('potato'));
    }
    const meal = this.world.items.find(i => isDish(i.kind) && i.location.type === 'station' && this.world.orders.some(o => ['active', 'late'].includes(o.status) && o.dishes.includes(i.kind as Dish)));
    if (meal?.location.type === 'station') return answer('把完成的餐品送出', '单点可直接出餐；套餐要先把几样餐品装进同一餐盒。', station(meal.location.stationId));
    const pattyCooking = this.world.items.some(i => i.kind === 'rawPatty' || i.kind === 'patty'), bun = this.world.items.some(i => i.kind === 'bun' || i.kind === 'assembly');
    if (tutorial?.stage === 'burger') return answer(tutorial.title, pattyCooking ? bun ? '等肉饼变绿，取走放到面包上；再拿起汉堡送到下方窗口。' : '煎台会自动烹饪，去拿面包放在空台面上。' : tutorial.text, pattyCooking ? bun ? station('grill-a') : station('bun') : station('meat'));
    const order = this.world.orders.find(o => (o.id === this.world.priorityOrderId || !this.world.priorityOrderId) && ['active', 'late'].includes(o.status));
    if (!order) return answer('看看厨房有什么需要', '可以提前备料、清理台面，也可以按 Q 调整队友岗位。');
    const missing = order.dishes.find(d => !this.world.items.some(i => i.kind === d)) ?? order.dishes[0];
    return answer('#' + order.id + ' · ' + DISH_NAMES[missing], '按 Q 分配岗位；公共台面上的食材和餐品都可以接着做。', station(missing === 'cola' ? 'cups' : missing === 'fries' ? 'potato' : missing === 'nuggets' ? 'chicken' : pattyCooking && !bun ? 'bun' : 'meat'));
  }
}
export const createKitchen = (options: KitchenOptions = {}) => new KitchenEngine(options);
