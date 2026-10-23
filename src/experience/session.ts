import { KitchenEngine } from '../kitchen/engine';
import { HZ, type KitchenCommand, type KitchenEvent, type KitchenOptions, type KitchenSnapshot, type LevelId, type AssistTarget } from '../kitchen/types';
import { audio } from '../game/audio';
import type { AssetProgress } from './assets';
import { loadPreferences, savePreferences, recordShift, loadScores, type VisualPreferences, type BestShift } from './preferences';
import { parseChallenge, type ChallengeSpec, type ChallengePreview } from '../challenges';
import { saveChallenge } from '../challenges/storage';

export type Panel = 'none' | 'orders' | 'command' | 'pause';
export interface SessionView {
  game: KitchenSnapshot;
  screen: 'title' | 'game'; panel: Panel; paused: boolean; pauseReason: string;
  ready: boolean; loading: AssetProgress; error: string;
  icons: Record<string, string>;
  preferences: VisualPreferences; scores: Partial<Record<LevelId, BestShift>>; saveError: string;
  challenge: ChallengePreview | null; commandActor: 'a' | 'b';
}
const TUTORIAL_KEY = 'mcrush-three-shifts-tutorial-2-';
export const hasLearnedKitchen = (level: LevelId = 'first-shift') => { try { return localStorage.getItem(TUTORIAL_KEY + level) === 'done'; } catch { return false; } };

/** One clock, one input queue. The renderer never advances or edits gameplay. */
export class KitchenSession {
  engine: KitchenEngine;
  private options: KitchenOptions;
  private view: SessionView;
  private listeners = new Set<() => void>();
  private keys = new Set<string>();
  private queue: KitchenCommand[] = [];
  private render: (() => void) | null = null;
  private raf = 0;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private resetClock = true;
  private lastPublished = 0;
  private histogram = new Uint32Array(20001);
  private frameCount = 0; private frameMax = 0; private elapsedMs = 0;
  private challengeSpec: ChallengeSpec | null = null;
  private lastAlarm = -1;
  private stepMs = 0; private renderMs = 0;
  private stalls = 0;
  private rendererInfo: (() => unknown) | null = null;
  private log: { tick: number; command: KitchenCommand }[] = [];

  constructor(options: KitchenOptions = {}) {
    this.options = { seed: 1024, ...options };
    this.engine = new KitchenEngine(this.options);
    this.view = { game: this.engine.getSnapshot(), screen: 'title', panel: 'none', paused: false, pauseReason: '', ready: false, loading: { loaded: 0, total: 1, label: '布置厨房' }, error: '', icons: {}, preferences: loadPreferences(), scores: loadScores(), saveError: '', challenge: null, commandActor: 'a' };
  }
  getView = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SessionView> = {}) {
    this.view = { ...this.view, ...patch, game: this.engine.getSnapshot() };
    for (const listener of this.listeners) listener();
  }
  beginLoading() { this.publish({ ready: false, error: '', loading: { loaded: 0, total: 1, label: '布置厨房' }, icons: {} }); }
  setLoading = (loading: AssetProgress) => { if (!this.view.error) this.publish({ loading, ready: false }); };
  setReady() { this.resetClock = true; this.publish({ ready: true, error: '' }); }
  setIcons(icons: Record<string, string>) { this.publish({ icons }); }
  setError(error: string) { this.clearInput(true); this.publish({ error, ready: false }); }
  attachRenderer(renderer: (() => void) | null, diagnostics: (() => unknown) | null = null) {
    this.render = renderer; this.rendererInfo = diagnostics; this.resetClock = true;
  }
  diagnostics() {
    const quantile = (q: number) => { let total=0; for(let i=0;i<this.histogram.length;i++) { total+=this.histogram[i]; if(total>=Math.ceil(this.frameCount*q)) return i/10; } return null; };
    return { scope: 'entire current round, foreground intervals including stalls', samples:this.frameCount, elapsedSeconds:this.elapsedMs/1000, p95:this.frameCount?quantile(.95):null, p99:this.frameCount?quantile(.99):null, max:this.frameMax, stalls:this.stalls, stepCpuMs:this.stepMs, renderCpuMs:this.renderMs, accumulator:this.accumulator, rendering:this.rendererInfo?.() };
  }
  setPreferences(patch: Partial<VisualPreferences>) { const preferences={...this.view.preferences,...patch}; savePreferences(preferences); this.publish({preferences}); }
  selectLevel(levelId: LevelId) {
    if(this.view.screen !== 'title') return;
    const changed=levelId!==this.engine.level.id;
    this.challengeSpec=null;
    this.options={...this.options,levelId,orders:undefined};
    this.engine=new KitchenEngine({...this.options,tutorial:false});
    this.publish({ ready:changed?false:this.view.ready,challenge:null });
  }
  importChallenge(spec: ChallengeSpec): string | null {
    if(this.view.screen !== 'title') return '请先回到关卡选择。';
    const checked=parseChallenge(JSON.stringify(spec));
    if(!checked.ok) return checked.error.message;
    const changed=this.engine.level.id!==checked.spec.levelId;
    this.challengeSpec=checked.spec;
    saveChallenge(checked.spec);
    this.options={...this.options,...checked.options};
    this.engine=new KitchenEngine({...this.options,tutorial:false});
    this.publish({challenge:checked.preview,ready:changed?false:this.view.ready});
    return null;
  }
  clearChallenge() { const current=this.engine.level.id; this.challengeSpec=null; this.options={...this.options,orders:undefined}; this.engine=new KitchenEngine({...this.options,levelId:current,tutorial:false});this.publish({challenge:null}); }
  chooseActor(actorId:'a'|'b') { this.publish({commandActor:actorId}); }
  assist(target:AssistTarget) { this.command({type:'assist',actorId:this.view.commandActor,target}); }
  assistContext(kind:'item'|'station'|'order') {
    const w=this.engine.readSnapshot(),preview=this.engine.getInteractionPreview();
    const id=kind==='item'?(w.actors[0].heldId??preview?.itemId):kind==='station'?preview?.stationId:(w.priorityOrderId??w.orders.find(o=>o.status==='active'||o.status==='late')?.id);
    if(id)this.assist({type:kind,id});
  }
  commandLog() { return structuredClone(this.log); }
  begin(tutorial: boolean, seed = this.options.seed ?? 1024) {
    if (!this.view.ready) return;
    if(this.challengeSpec) { const check=parseChallenge(JSON.stringify(this.challengeSpec)); if(!check.ok) { this.publish({saveError:check.error.message});return; } seed=this.challengeSpec.seed; }
    audio.unlock();
    this.options = { ...this.options, seed, tutorial };
    this.engine = new KitchenEngine(this.options);
    this.clearInput(); this.queue = []; this.log = []; this.accumulator = 0; this.histogram.fill(0); this.frameCount=0; this.frameMax=0; this.elapsedMs=0; this.stepMs=0; this.renderMs=0; this.lastAlarm=-1; this.stalls = 0; this.resetClock = true;
    audio.start(); audio.sound('ui');
    this.publish({ screen: 'game', panel: 'none', paused: false, pauseReason: '', saveError:'' });
  }
  retry = () => this.begin(false);
  home = () => {
    this.clearInput(); this.queue = []; this.accumulator = 0; this.resetClock = true;
    audio.stop(); this.engine = new KitchenEngine({ ...this.options, tutorial: false });
    this.publish({ screen: 'title', panel: 'none', paused: false, pauseReason: '' });
  };
  command(command: KitchenCommand) {
    if (this.view.screen === 'game' && !this.view.paused && this.view.ready && this.view.game.phase !== 'results') this.queue.push(command);
  }
  private clearInput(discardPending = false) {
    this.keys.clear();
    // Closing a panel releases held keys without losing accepted one-shot actions.
    const pending = discardPending ? [] : this.queue.filter(c => !['move', 'work', 'dash', 'throw'].includes(c.type));
    this.queue = [...pending, { type: 'move', x: 0, y: 0 }, { type: 'work', held: false }, { type: 'dash', held: false }, { type: 'throw', held: false, cancel: true }];
  }
  setPanel(panel: Panel) {
    if (this.view.screen !== 'game' || this.view.game.phase === 'results') return;
    const paused = panel === 'pause';
    this.clearInput(paused);
    if (paused !== this.view.paused) { audio.pause(paused); this.resetClock = true; }
    this.publish({ panel, paused, pauseReason: paused ? this.view.pauseReason : '' });
  }
  pause(reason = '') {
    if (this.view.screen !== 'game' || this.view.game.phase === 'results') return;
    this.publish({ pauseReason: reason }); this.setPanel('pause');
  }
  resume = () => { audio.unlock(); this.setPanel('none'); };
  start() {
    if (this.running) return;
    this.running = true; this.resetClock = true;
    window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur); window.addEventListener('focus', this.focus);
    document.addEventListener('visibilitychange', this.visibility);
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() {
    this.running = false; cancelAnimationFrame(this.raf); this.clearInput(true); audio.stop();
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur); window.removeEventListener('focus', this.focus);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  private blur = () => { this.clearInput(); if (this.view.game.phase === 'results') audio.pause(true); else this.pause('窗口失去焦点，厨房已暂停'); };
  private focus = () => { if (this.view.game.phase === 'results') audio.pause(document.hidden); };
  private visibility = () => { if (document.hidden) this.blur(); };
  private movement() {
    this.command({ type: 'move', x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), y: Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')) });
    this.command({ type: 'dash', held: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') });
    this.command({ type: 'work', held: this.keys.has('Space') });
    this.command({ type: 'throw', held: this.keys.has('KeyF') });
  }
  private keyDown = (event: KeyboardEvent) => {
    if (this.view.screen !== 'game' || this.view.game.phase === 'results') return;
    if ((event.target as HTMLElement)?.matches('input, textarea, select')) return;
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) this.view.panel === 'none' ? this.pause() : this.resume(); return; }
    if (this.view.paused) return;
    if (event.code === 'KeyQ') { event.preventDefault(); if (!event.repeat) this.setPanel(this.view.panel === 'command' ? 'none' : 'command'); return; }
    if (event.code === 'Tab' && this.view.panel !== 'command') { event.preventDefault(); if (!event.repeat) this.setPanel(this.view.panel === 'orders' ? 'none' : 'orders'); return; }
    if (this.view.panel === 'command') {
      if(event.repeat)return;
      if(event.code==='Digit1'||event.code==='Digit2'){event.preventDefault();this.chooseActor(event.code==='Digit1'?'a':'b');return;}
      const kind=({KeyE:'item',KeyR:'station',KeyT:'order'} as const)[event.code as 'KeyE'|'KeyR'|'KeyT'];
      if(kind){event.preventDefault();this.assistContext(kind);return;}
      if(event.code==='KeyX'){event.preventDefault();this.command({type:'assist-cancel',actorId:this.view.commandActor});return;}
    }
    if (this.view.panel !== 'none') return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space', 'KeyF', 'ShiftLeft', 'ShiftRight'].includes(event.code)) return;
    event.preventDefault(); audio.unlock();
    if (event.code === 'KeyE') { if (!event.repeat) this.command({ type: 'interact' }); return; }
    if (!this.keys.has(event.code)) { this.keys.add(event.code); this.movement(); }
  };
  private keyUp = (event: KeyboardEvent) => { if (this.keys.delete(event.code)) this.movement(); };
  private emit(events: KitchenEvent[]) {
    const sounds: Partial<Record<KitchenEvent['type'], string>> = { pickup: 'pickup', place: 'ui', work: 'work', ready: 'cooked', burnt: 'rejected', assemble: 'complete', handoff: 'assigned', throw: 'ui', catch: 'pickup', serve: 'served', reject: 'rejected', order: 'order', phase: 'phase', role: 'assigned', priority: 'priority', tutorial: 'tutorial', assist:'assigned', wave:'order' };
    for (const event of events) if (sounds[event.type]) audio.sound(sounds[event.type]);
  }
  private frame = (now: number) => {
    if (!this.running) return;
    if (this.resetClock || !this.view.ready || !this.render) { this.lastTime = now; this.resetClock = false; }
    const elapsed = now - this.lastTime; this.lastTime = now;
    if (this.view.screen === 'game' && !this.view.paused && this.view.game.phase !== 'results' && this.view.ready && this.render) {
      this.histogram[Math.min(20000,Math.max(0,Math.round(elapsed*10)))]++; this.frameCount++;this.frameMax=Math.max(this.frameMax,elapsed);this.elapsedMs+=elapsed;
      if (elapsed > 2000) { this.stalls++; this.pause('浏览器长时间停顿，厨房已暂停。继续后从原进度开始。'); }
      else {
        // No elapsed-time clamp: low rendering rates retain every simulation step.
        this.accumulator += elapsed;
        let important = false;
        while (this.accumulator >= 1000 / HZ) {
          const commands = this.queue.splice(0), before = this.engine.readSnapshot(), tick=before.tick;
          for (const command of commands) this.log.push({ tick, command });
          const previous = before.phase, stepStart=performance.now();
          const events = this.engine.step(commands); this.accumulator -= 1000 / HZ;
          this.stepMs+=performance.now()-stepStart; this.emit(events);
          important ||= events.some(event => event.type !== 'work');
          const current = this.engine.readSnapshot().phase;
          if (previous === 'tutorial' && current !== 'tutorial') {
            this.clearInput();
            try { localStorage.setItem(TUTORIAL_KEY + this.engine.level.id, 'done'); } catch { /* optional preference */ }
          }
          if (current === 'results') { this.clearInput(); this.accumulator = 0; const saved=this.challengeSpec?true:recordShift(this.engine.getSnapshot()); this.publish({scores:loadScores(),saveError:saved?'':'本次成绩未能保存，仍可重试。'}); break; }
        }
        const state=this.engine.readSnapshot(), phase=state.phase;
        if(phase==='service'&&state.orders.some(o=>o.status==='active'&&o.due-state.serviceTick<=10*HZ)&&state.tick-this.lastAlarm>8*HZ){audio.sound('near-due');this.lastAlarm=state.tick;}
        audio.setPhase(phase === 'service' ? 'rush' : phase === 'closing' ? 'backlog' : phase === 'results' ? 'results' : 'prep');
        if (important || now - this.lastPublished >= 100) { this.lastPublished = now; this.publish(); }
      }
    }
    const renderStart=performance.now();this.render?.();this.renderMs+=performance.now()-renderStart; this.raf = requestAnimationFrame(this.frame);
  };
}
