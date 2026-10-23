type AudioPhase = 'prep' | 'trial' | 'rush' | 'backlog' | 'results';
interface AudioEvent { type:string; taskId?:string }
export interface SoundSettings { master: number; music: number; effects: number; muted: boolean }
const defaults: SoundSettings = { master: .7, music: .5, effects: .65, muted: false };
const clamp = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
/** One audio graph for the app. Music is an original local composition; effects
 * are soft sine/FM tones and filtered noise, synthesized once per context. */
class KitchenAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private stemGains: GainNode[] = [];
  private buffers: AudioBuffer[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private loading: Promise<void> | null = null;
  private effectBuffers = new Map<string, AudioBuffer>();
  private phase: AudioPhase = 'prep';
  private playing = false;
  private paused = false;
  private startTime = 0;
  private offset = 0;
  private generation = 0;
  private voices = new Set<AudioBufferSourceNode>();
  private lastSound = new Map<string, number>();
  private counts: Record<string, number> = {};
  private settings: SoundSettings = { ...defaults };
  private listeners = new Set<() => void>();
  private error = '';
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('mcrush-sound') ?? 'null');
      if (saved) this.settings = { master: clamp(saved.master, defaults.master), music: clamp(saved.music, defaults.music), effects: clamp(saved.effects, defaults.effects), muted: saved.muted === true };
    } catch { /* Sound preferences never prevent play. */ }
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSettings = () => this.settings;
  setSettings(next: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...next }; this.applyLevels();
    try { localStorage.setItem('mcrush-sound', JSON.stringify(this.settings)); } catch { /* optional */ }
    this.listeners.forEach(fn => fn());
  }
  // Invoke synchronously in a real click/keyboard handler to satisfy autoplay rules.
  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain(); this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024; this.master.connect(this.analyser); this.analyser.connect(this.context.destination);
        this.music = this.context.createGain(); this.music.connect(this.master);
        this.effects = this.context.createGain(); this.effects.connect(this.master);
        this.stemGains = [0,1,2].map(() => { const gain = this.context!.createGain(); gain.connect(this.music!); return gain; });
        this.applyLevels();
      }
      void this.context.resume().catch(() => { this.error = '音频暂未解锁'; });
      if (!this.loading) this.loading = this.load();
    } catch { this.error = '这个浏览器无法播放音频'; }
  }
  private async load() {
    try {
      this.buffers = await Promise.all(['warm','melody','groove'].map(async name => {
        const response = await fetch('/audio/' + name + '.wav');
        if (!response.ok) throw new Error('Missing local audio ' + name);
        return this.context!.decodeAudioData(await response.arrayBuffer());
      }));
      if (this.playing && !this.paused) this.startSources();
    } catch { this.error = '本地音乐未能加载'; }
  }
  private applyLevels() {
    if (!this.context) return;
    const t = this.context.currentTime;
    for (const [node,value] of [[this.master,this.settings.muted ? 0 : this.settings.master], [this.music,this.settings.music], [this.effects,this.settings.effects]] as const) node?.gain.setTargetAtTime(value, t, .04);
    this.applyPhase();
  }
  private applyPhase() {
    const levels = this.phase === 'rush' ? [.65,.48,.54] : this.phase === 'trial' ? [.6,.4,.15] : this.phase === 'backlog' ? [.55,.28,.28] : this.phase === 'results' ? [.55,.18,0] : [.58,.26,0];
    this.stemGains.forEach((gain,i) => gain.gain.setTargetAtTime(levels[i], this.context!.currentTime, .6));
  }
  setPhase(phase: AudioPhase) { if (phase !== this.phase) { this.phase = phase; this.applyPhase(); } }
  start() { this.playing = true; this.paused = false; this.offset = 0; this.phase = 'prep'; this.applyPhase(); if (this.buffers.length) this.startSources(); }
  private startSources() {
    if (!this.context || !this.buffers.length || this.sources.length) return;
    const when = this.context.currentTime + .03; this.startTime = when;
    this.sources = this.buffers.map((buffer,i) => {
      const source = this.context!.createBufferSource(); source.buffer = buffer; source.loop = true;
      source.connect(this.stemGains[i]); source.start(when, this.offset % buffer.duration); return source;
    });
  }
  private stopSources() {
    if (this.context && this.sources.length) this.offset += Math.max(0,this.context.currentTime - this.startTime);
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    this.sources = [];
    for (const voice of this.voices) { voice.onended = null; voice.stop(); voice.disconnect(); }
    this.voices.clear();
  }
  pause(paused: boolean) {
    this.paused = paused;
    if (paused) this.stopSources(); else { this.unlock(); if (this.playing) this.startSources(); }
  }
  stop() { this.playing = false; this.paused = false; this.generation++; this.stopSources(); this.offset = 0; this.lastSound.clear(); }
  emit(events: readonly AudioEvent[]) {
    for (const event of events) {
      if (event.type === 'hint' || event.type === 'claimed' || event.type === 'role' || event.type === 'tutorial-dispatched') continue;
      const name = event.type === 'completed-task' ? 'complete' : event.type === 'work' ? event.taskId?.match(/-(fry|grill)$/) ? 'sizzle' : 'work' : event.type;
      this.sound(name);
    }
  }
  sound(name = 'ui') {
    if (!this.context || this.paused || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - (this.lastSound.get(name) ?? -Infinity) < (name === 'work' ? .35 : .08)) return;
    this.lastSound.set(name, now); this.counts[name] = (this.counts[name] ?? 0) + 1;
    if (this.settings.muted || !this.settings.effects || this.voices.size >= 8) return;
    let buffer = this.effectBuffers.get(name);
    if (!buffer) { buffer = this.effect(name); this.effectBuffers.set(name,buffer); }
    const voice = this.context.createBufferSource(), token = this.generation;
    voice.buffer = buffer; voice.connect(this.effects!); this.voices.add(voice);
    voice.onended = () => { if (token === this.generation) this.voices.delete(voice); voice.disconnect(); }; voice.start();
  }
  private effect(name: string) {
    const notes: Record<string, number[]> = { ui:[74], pickup:[67,72], complete:[72,76], assigned:[67,72,76], order:[76,79], 'near-due':[74,70], cooked:[79,76], served:[72,76,79,84], rejected:[55,52], achievement:[72,76,79,86], phase:[65,69,72], priority:[72,79], tutorial:[72,76,79], results:[72,76,79,84], work:[48] };
    const tones = notes[name] ?? notes.ui, length = tones.length*.085 + .14;
    const buffer = this.context!.createBuffer(1,Math.ceil(length*this.context!.sampleRate),this.context!.sampleRate), data = buffer.getChannelData(0), sr = buffer.sampleRate;
    if(name==='sizzle'){let noise=13,low=0;for(let i=0;i<data.length;i++){noise=(noise*16807)%2147483647;low=low*.85+(noise/2147483647*2-1)*.15;data[i]=low*.19*Math.sin(Math.PI*i/data.length)**2;}return buffer;}
    for (let i=0;i<tones.length;i++) {
      const frequency = 440*2**((tones[i]-69)/12), start = Math.floor(i*.085*sr);
      for (let j=0;j<.2*sr && start+j<data.length;j++) {
        const t=j/sr, env=Math.min(1,t/.006)*Math.exp(-t*25)*Math.max(0,1-t/.2);
        data[start+j] += .16*env*(Math.sin(2*Math.PI*frequency*t)+.08*Math.sin(4*Math.PI*frequency*t));
      }
    }
    return buffer;
  }
  diagnostics() { const samples=new Float32Array(1024);this.analyser?.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);return { rms, phase:this.phase, state:this.context?.state ?? 'locked', stems:this.sources.length, voices:this.voices.size, loaded:this.buffers.length, settings:{...this.settings}, counts:{...this.counts}, error:this.error }; }
}
export const audio = new KitchenAudio();
