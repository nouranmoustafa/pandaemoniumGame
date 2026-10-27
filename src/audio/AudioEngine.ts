import type { EventBus } from '../core/Events';

/**
 * Procedural sound: wind, a low drone, a sparse music-box motif, footsteps,
 * rustling grass, creaking trees, the grinding pavement and impacts.
 * Everything is synthesized, so there are no audio assets to load yet;
 * a sample-based layer can be added behind the same event hooks later.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private slideGain!: GainNode;
  private slideFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private musicTimer = 0;
  private muted = false;

  constructor(bus: EventBus) {
    bus.on('visitor:step', ({ speed }) => this.footstep(speed));
    bus.on('visitor:caught', ({ by }) => this.impact(by));
    bus.on('obstacle:warn', ({ kind }) => (kind === 'grass' ? this.rustle(1.2) : this.creak()));
    bus.on('obstacle:strike', ({ kind }) => (kind === 'grass' ? this.burst() : this.whoosh()));
    bus.on('pavement:rise', () => this.grind(5));
    bus.on('pavement:slide', () => this.grind(3));
    bus.on('demon:line', () => this.whisper());
    bus.on('visitor:lane', () => this.swish());
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.0001;
    this.amb.connect(this.master);
    this.amb.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 4);

    // Noise buffer (brownish).
    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 3 + w * 0.15;
    }

    // Synthetic reverb impulse.
    this.reverb = ctx.createConvolver();
    const rl = ctx.sampleRate * 3.5;
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < rl; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.startAmbience();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private noise(loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Wind.
    const wind = this.noise(true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.22;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    wind.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    lfo.start();

    // Drone: two detuned low tones, slowly beating.
    for (const [f, g] of [
      [55, 0.05],
      [55.7, 0.05],
      [82.4, 0.025],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(lp).connect(gn).connect(this.amb);
      o.start();
    }

    // Slide scrape (silent until sliding).
    const scrape = this.noise(true);
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass';
    this.slideFilter.frequency.value = 900;
    this.slideFilter.Q.value = 0.6;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    scrape.connect(this.slideFilter).connect(this.slideGain).connect(this.sfx);
    scrape.start();

    // Deep rumble bed for the pavement.
    const rumble = this.noise(true);
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 90;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(rlp).connect(this.rumbleGain).connect(this.sfx);
    rumble.start();
  }

  /** Continuous parameters, once per frame. */
  update(dt: number, p: { speed: number; sliding: boolean; gust: number; playing: boolean }): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.18 + p.gust * 0.5 + Math.min(p.speed, 20) * 0.006, t, 0.3);
    this.slideGain.gain.setTargetAtTime(p.sliding ? 0.05 + p.speed * 0.006 : 0, t, 0.15);
    this.slideFilter.frequency.setTargetAtTime(500 + p.speed * 45, t, 0.2);

    // Music box: a sparse, slightly detuned minor motif.
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = p.playing ? 2.6 + Math.random() * 3 : 1.8 + Math.random() * 1.5;
      const scale = [0, 3, 7, 10, 12, 15, 14, 8];
      const note = scale[Math.floor(Math.random() * scale.length)];
      this.pluck(440 * Math.pow(2, (note - 12) / 12) * (1 + (Math.random() - 0.5) * 0.008), 0.06);
      if (Math.random() < 0.4) setTimeout(() => this.pluck(440 * Math.pow(2, (scale[(note + 2) % 8] - 12) / 12), 0.04), 420);
    }
  }

  private env(g: GainNode, peak: number, attack: number, decay: number): void {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private pluck(freq: number, vol: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    o.connect(g);
    o2.connect(g);
    g.connect(this.amb);
    g.connect(this.reverbSend);
    this.env(g, vol, 0.005, 2.2);
    o.start();
    o2.start();
    o.stop(ctx.currentTime + 2.5);
    o2.stop(ctx.currentTime + 2.5);
  }

  private footstep(speed: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300 + Math.random() * 600;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, 0.12 + Math.min(speed, 13) * 0.012, 0.004, 0.09);
    n.start(ctx.currentTime, Math.random() * 2, 0.15);
    // Heel thud.
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.08);
    const og = ctx.createGain();
    o.connect(og).connect(this.sfx);
    this.env(og, 0.12, 0.003, 0.08);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  }

  private rustle(dur: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.start(t, Math.random() * 1.5, dur + 0.1);
  }

  private burst(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // Cracking cobbles + wet snap.
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const n = this.noise();
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 600 + Math.random() * 2400;
        f.Q.value = 3;
        const g = ctx.createGain();
        n.connect(f).connect(g).connect(this.sfx);
        this.env(g, 0.25, 0.002, 0.07);
        n.start(ctx.currentTime, Math.random() * 2, 0.1);
      }, i * 28);
    }
    this.thud(70, 0.3);
  }

  private creak(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(130, t + 0.6);
    o.frequency.linearRampToValueAtTime(95, t + 1.3);
    const wob = ctx.createOscillator();
    wob.frequency.value = 23;
    const wg = ctx.createGain();
    wg.gain.value = 12;
    wob.connect(wg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 6;
    const g = ctx.createGain();
    o.connect(f).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverbSend);
    this.env(g, 0.22, 0.2, 1.2);
    o.start();
    wob.start();
    o.stop(t + 1.6);
    wob.stop(t + 1.6);
  }

  private whoosh(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, 0.35, 0.12, 0.2);
    n.start(t, Math.random(), 0.45);
    setTimeout(() => this.thud(55, 0.35), 230);
  }

  private swish(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1600;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, 0.05, 0.03, 0.12);
    n.start(ctx.currentTime, Math.random(), 0.2);
  }

  private thud(freq: number, vol: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.3);
    const g = ctx.createGain();
    o.connect(g).connect(this.sfx);
    this.env(g, vol, 0.005, 0.35);
    o.start();
    o.stop(t + 0.4);
  }

  private impact(by: 'grass' | 'branch'): void {
    this.thud(by === 'branch' ? 60 : 80, 0.5);
    // Heartbeat.
    setTimeout(() => this.thud(45, 0.4), 260);
    setTimeout(() => this.thud(42, 0.3), 480);
    if (by === 'grass') this.rustle(0.5);
  }

  private grind(dur: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rumbleGain.gain.cancelScheduledValues(t);
    this.rumbleGain.gain.setValueAtTime(this.rumbleGain.gain.value, t);
    this.rumbleGain.gain.linearRampToValueAtTime(0.9, t + 0.8);
    this.rumbleGain.gain.linearRampToValueAtTime(0.25, t + dur);
    this.rumbleGain.gain.linearRampToValueAtTime(0, t + dur + 3);
    this.creak();
    setTimeout(() => this.creak(), 900);
  }

  private whisper(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 4;
    const g = ctx.createGain();
    n.connect(f).connect(g);
    g.connect(this.reverbSend);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.start(t, Math.random(), 1.5);
    // A low reversed-bell swell underneath.
    const o = ctx.createOscillator();
    o.frequency.value = 110;
    const og = ctx.createGain();
    o.connect(og);
    og.connect(this.reverbSend);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.06, t + 0.9);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.start();
    o.stop(t + 1.7);
  }
}
