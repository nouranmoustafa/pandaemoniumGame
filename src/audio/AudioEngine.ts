import type { CatchCause, EventBus, HazardKind, HouseSound } from '../core/Events';
import { SampleBank } from './SampleBank';

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
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private peace = false;
  // --- Prologue: the town at dusk ---
  private cityGain!: GainNode;
  private murmurGain!: GainNode;
  private duskPadGain!: GainNode;
  /** 0..1 — how much of the ordinary evening is still audible. */
  private city = 0;
  private carTimer = 4;
  private duskTimer = 1;
  private duskStep = 0;
  private birdTimer = 3;
  private insectTimer = 2;
  private owlDone = false;
  /** Where her feet are: flagstones on the plaza, cobbles in the park. */
  surface: 'flagstone' | 'cobble' = 'cobble';
  /** Optional licensed recordings, used in place of synthesis when present. */
  readonly samples = new SampleBank();

  constructor(bus: EventBus) {
    bus.on('visitor:step', ({ speed }) => this.footstep(speed));
    bus.on('visitor:caught', ({ by }) => this.impact(by));
    bus.on('obstacle:warn', ({ kind }) => this.warnSound(kind));
    bus.on('obstacle:strike', ({ kind }) => this.strikeSound(kind));
    bus.on('obstacle:end', ({ kind }) => {
      if (kind === 'fire') this.ashCollapse();
    });
    bus.on('pavement:rise', () => this.grind(5));
    bus.on('pavement:slide', () => this.grind(3));
    bus.on('pavement:sarcasm', () => this.grind(2));
    bus.on('demon:line', () => this.whisper());
    bus.on('demon:remark', () => {
      this.whisper();
      setTimeout(() => this.bell(98, 0.12), 300);
    });
    bus.on('demon:phase', ({ phase }) => this.phaseShift(phase === 'desperate' ? 2 : 1));
    bus.on('visitor:lane', () => this.swish());
    bus.on('visitor:dodge', () => this.relief());
    bus.on('visitor:blown', () => {
      this.thud(70, 0.25);
      this.swish();
    });
    bus.on('trick:sign', () => this.creak(1.8, 0.12));
    bus.on('trick:bench', () => this.bell(130.8, 0.1));
    bus.on('trick:lights', () => this.hum());
    bus.on('prologue:sound', ({ id }) => this.prologueSound(id));
    bus.on('house:sound', ({ id }) => this.houseSound(id));
    bus.on('trick:shortcut', ({ active }) => {
      if (!active) {
        this.thud(40, 0.45);
        this.bell(73.4, 0.18);
      }
    });
  }

  private warnSound(kind: HazardKind): void {
    switch (kind) {
      case 'grass':
        return this.rustle(1.2);
      case 'branch':
        return this.creak();
      case 'wind':
        return this.howl(1.4, 0.18);
      case 'water':
        return this.gurgle();
      case 'fire':
        return this.embersHiss();
    }
  }

  private strikeSound(kind: HazardKind): void {
    switch (kind) {
      case 'grass':
        return this.burst();
      case 'branch':
        return this.whoosh();
      case 'wind':
        return this.howl(2.2, 0.35);
      case 'water':
        return this.fountain();
      case 'fire':
        return this.ignite();
    }
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
    void this.samples.load(ctx, import.meta.env.BASE_URL);
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

    // Drone: two detuned low tones, slowly beating. It tightens as the Demon loses patience.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 1;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 180;
    this.droneFilter.connect(this.droneGain).connect(this.amb);
    for (const [f, g] of [
      [55, 0.05],
      [55.7, 0.05],
      [82.4, 0.025],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(this.droneFilter);
      o.start();
    }
    // Warm pad, silent except during the false shortcut's lie of safety.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.amb);
    this.padGain.connect(this.reverbSend);
    for (const f of [130.8, 164.8, 196, 261.6]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.value = 0.02;
      o.connect(gn).connect(this.padGain);
      o.start();
    }

    // The town: a traffic hum that breathes, and indistinct friendly talk.
    this.cityGain = ctx.createGain();
    this.cityGain.gain.value = 0;
    this.cityGain.connect(this.amb);
    const traffic = this.noise(true);
    const tlp = ctx.createBiquadFilter();
    tlp.type = 'lowpass';
    tlp.frequency.value = 260;
    const tg = ctx.createGain();
    tg.gain.value = 0.5;
    traffic.connect(tlp).connect(tg).connect(this.cityGain);
    traffic.start();
    const tl = ctx.createOscillator();
    tl.frequency.value = 0.09;
    const tlg = ctx.createGain();
    tlg.gain.value = 0.18;
    tl.connect(tlg).connect(tg.gain);
    tl.start();
    this.murmurGain = ctx.createGain();
    this.murmurGain.gain.value = 0;
    this.murmurGain.connect(this.amb);
    this.murmurGain.connect(this.reverbSend);
    for (const [fq, rate] of [
      [520, 4.3],
      [880, 5.1],
      [1350, 3.7],
    ] as const) {
      // Formant-band noise gated at a syllable rate: talk without words.
      const n = this.noise(true);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = 3;
      const vg = ctx.createGain();
      vg.gain.value = 0;
      const syl = ctx.createOscillator();
      syl.type = 'triangle';
      syl.frequency.value = rate;
      const sg = ctx.createGain();
      sg.gain.value = 0.5;
      syl.connect(sg).connect(vg.gain);
      n.connect(bp).connect(vg).connect(this.murmurGain);
      n.start(0, Math.random() * 2);
      syl.start();
    }
    // A subdued, slightly melancholy pad: A minor with an added ninth.
    this.duskPadGain = ctx.createGain();
    this.duskPadGain.gain.value = 0;
    this.duskPadGain.connect(this.amb);
    this.duskPadGain.connect(this.reverbSend);
    for (const fq of [110, 164.8, 246.9, 261.6]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fq;
      const gn = ctx.createGain();
      gn.gain.value = 0.016;
      const vib = ctx.createOscillator();
      vib.frequency.value = 0.2 + Math.random() * 0.2;
      const vibG = ctx.createGain();
      vibG.gain.value = 0.6;
      vib.connect(vibG).connect(o.frequency);
      o.connect(gn).connect(this.duskPadGain);
      o.start();
      vib.start();
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
  update(
    dt: number,
    p: { speed: number; sliding: boolean; gust: number; playing: boolean; peace?: boolean; anxiety?: number; city?: number; prologue?: boolean; indoor?: boolean },
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const peace = !!p.peace;
    const anx = p.anxiety ?? 0;
    const city = p.city ?? 0;
    this.city = city;
    this.peace = peace;
    // The town recedes as she walks in; the wind and the drone take its place.
    this.cityGain.gain.setTargetAtTime(city * 0.55, t, 0.8);
    this.murmurGain.gain.setTargetAtTime(Math.pow(city, 2) * 0.07, t, 0.8);
    this.duskPadGain.gain.setTargetAtTime(p.prologue ? Math.pow(city, 1.5) * 0.9 : 0, t, 1.5);
    // Indoors (Stage 4) the wind is only a draught under the door.
    const outside = p.indoor ? 0.12 : 1;
    this.windGain.gain.setTargetAtTime(((peace ? 0.06 : 0.18) + p.gust * 0.5 + Math.min(p.speed, 20) * 0.006) * (1 - city * 0.55) * outside, t, p.indoor ? 0.08 : 0.3);
    this.slideGain.gain.setTargetAtTime(p.sliding ? 0.05 + p.speed * 0.006 : 0, t, 0.15);
    this.slideFilter.frequency.setTargetAtTime(500 + p.speed * 45, t, 0.2);
    this.padGain.gain.setTargetAtTime(peace ? 1 : 0, t, peace ? 1.5 : 0.4);
    this.droneGain.gain.setTargetAtTime((peace ? 0.25 : 1 + anx * 0.8) * (1 - city * 0.95) * (p.indoor ? 0.55 : 1), t, 0.8);
    if (city > 0.35) {
      this.carTimer -= dt;
      if (this.carTimer <= 0) {
        this.carTimer = 5 + Math.random() * 7;
        this.carPass(city);
      }
    }
    if (p.prologue) this.duskLife(dt, city);
    if (p.prologue && city > 0.25) {
      // A few soft low notes, unhurried.
      this.duskTimer -= dt;
      if (this.duskTimer <= 0) {
        const motif = [57, 60, 64, 62, 60, 59, 57, 52];
        const m = motif[this.duskStep++ % motif.length];
        this.duskTimer = 2.4 + (this.duskStep % 4 === 0 ? 1.6 : 0);
        this.pluck(440 * Math.pow(2, (m - 69) / 12), 0.05 * city);
      }
    }
    this.droneFilter.frequency.setTargetAtTime(180 + anx * 260, t, 1);

    // Music box: a sparse, slightly detuned minor motif. Silent during the shortcut; hurried when anxious.
    this.musicTimer -= dt * (1 + anx * 0.8);
    if (this.musicTimer <= 0 && !peace && city < 0.5) {
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
    if (this.samples.play(ctx, this.sfx, 'footstep', 0.5 + Math.min(speed, 12) * 0.04, 0.94 + Math.random() * 0.12)) return;
    if (speed < 2.6) this.heelClick(speed);
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300 + Math.random() * 600;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    // In the quiet of the park her own steps become noticeable.
    const quiet = 1 + (1 - this.city) * 0.35 - this.city * 0.25;
    this.env(g, (0.12 + Math.min(speed, 13) * 0.012) * quiet, 0.004, 0.09);
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

  /** Walking: the boot heel on stone, crisp on the flagstones and softer on the cobbles. */
  private heelClick(speed: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = this.surface === 'flagstone' ? 3200 + Math.random() * 500 : 2100 + Math.random() * 400;
    bp.Q.value = 3;
    const g = ctx.createGain();
    n.connect(bp).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverbSend);
    const v = (this.surface === 'flagstone' ? 0.09 : 0.06) * (0.7 + speed * 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.start(t, Math.random() * 2, 0.08);
  }

  /**
   * The life of the evening, then its absence: a few distant birds settling
   * while the town is still audible; inside the gate, a slow insect pulse
   * and, once, an owl somewhere off the path.
   */
  private duskLife(dt: number, city: number): void {
    const ctx = this.ctx!;
    if (city > 0.6) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 3 + Math.random() * 5;
        const base = 2600 + Math.random() * 1400;
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const t = ctx.currentTime + i * (0.11 + Math.random() * 0.05);
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(base, t);
          o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), t + 0.06);
          const g = ctx.createGain();
          o.connect(g);
          g.connect(this.amb);
          g.connect(this.reverbSend);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.012 * city, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          o.start(t);
          o.stop(t + 0.1);
        }
      }
    }
    if (city < 0.55) {
      this.insectTimer -= dt;
      if (this.insectTimer <= 0) {
        this.insectTimer = 0.9 + Math.random() * 0.8;
        for (let i = 0; i < 3; i++) {
          const t = ctx.currentTime + i * 0.045;
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = 4300;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 4300;
          bp.Q.value = 8;
          const g = ctx.createGain();
          o.connect(bp).connect(g).connect(this.amb);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.006 * (1 - city), t + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
          o.start(t);
          o.stop(t + 0.04);
        }
      }
    }
    if (!this.owlDone && city < 0.35) {
      this.owlDone = true;
      if (!this.samples.play(ctx, this.reverbSend, 'owl', 0.5)) {
        // Two low, breathy hoots, far off.
        for (const [at, len] of [
          [0, 0.32],
          [0.55, 0.6],
        ] as const) {
          const t = ctx.currentTime + at;
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(410, t);
          o.frequency.linearRampToValueAtTime(370, t + len);
          const g = ctx.createGain();
          o.connect(g);
          g.connect(this.reverbSend);
          g.connect(this.amb);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.03, t + 0.06);
          g.gain.setValueAtTime(0.03, t + len * 0.7);
          g.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.start(t);
          o.stop(t + len + 0.05);
        }
      }
    }
  }

  /** Stage 4: the house's own sounds. */
  private houseSound(id: HouseSound): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    switch (id) {
      case 'creak':
        // The front door swinging wide, slowly.
        this.creak(0.62, 0.3);
        this.creakAt(0.9, 0.55, 0.18);
        break;
      case 'slam':
        this.thud(48, 0.7);
        this.thud(90, 0.35);
        this.bell(41.2, 0.12);
        setTimeout(() => this.rustle(0.4), 60);
        break;
      case 'rattle':
        for (let i = 0; i < 6; i++) {
          setTimeout(() => this.thud(140 + Math.random() * 40, 0.12), i * 85 + (i > 2 ? 260 : 0));
        }
        break;
      case 'candle': {
        // A wick catching: a soft breathy flare.
        const n = this.noise();
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(2600, t + 0.25);
        f.Q.value = 1.2;
        const g = ctx.createGain();
        n.connect(f).connect(g);
        g.connect(this.sfx);
        g.connect(this.reverbSend);
        this.env(g, 0.09, 0.03, 0.4);
        n.start(t, Math.random(), 0.5);
        break;
      }
      case 'organ': {
        // A single held minor chord from somewhere upstairs, slightly out of tune.
        for (const [m, det] of [
          [45, -4],
          [52, 3],
          [57, 0],
          [60, 6],
          [64, -3],
        ] as const) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
          o.detune.value = det;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 900;
          const g = ctx.createGain();
          o.connect(lp).connect(g);
          g.connect(this.amb);
          g.connect(this.reverbSend);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.022, t + 2.5);
          g.gain.setValueAtTime(0.022, t + 9);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 16);
          o.start(t);
          o.stop(t + 16.2);
        }
        break;
      }
      case 'silk':
      case 'sheet':
        this.rustle(id === 'sheet' ? 1.4 : 0.9);
        break;
      case 'snap':
        this.swish();
        this.thud(70, 0.2);
        break;
      case 'bell':
        this.bell(98, 0.16);
        break;
    }
  }

  /** Reset the once-per-run sounds (the owl). */
  resetAmbience(): void {
    this.owlDone = false;
  }

  /** A car going by somewhere behind the houses. */
  private carPass(level: number): void {
    const ctx = this.ctx!;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(220, t);
    f.frequency.linearRampToValueAtTime(520, t + 1.8);
    f.frequency.linearRampToValueAtTime(260, t + 3.6);
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.amb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * level, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
    n.start(t, Math.random(), 4);
  }

  private prologueSound(id: 'buzz' | 'notify' | 'swing' | 'branch' | 'flicker' | 'grass' | 'send' | 'laugh'): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    switch (id) {
      case 'laugh':
        // A recorded laugh when one has been supplied; otherwise the group's murmur only
        // warms and swells. A synthesized laugh would sound wrong here.
        if (!this.samples.play(ctx, this.amb, 'laugh', 0.35)) {
          this.murmurGain.gain.cancelScheduledValues(t);
          this.murmurGain.gain.setValueAtTime(this.murmurGain.gain.value, t);
          this.murmurGain.gain.linearRampToValueAtTime(0.16 * this.city, t + 0.25);
          this.murmurGain.gain.linearRampToValueAtTime(0.07 * this.city * this.city, t + 1.6);
        }
        break;
      case 'buzz': {
        // A phone vibrating in a coat pocket: two short, muffled pulses.
        for (const at of [0, 0.42]) {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = 170;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 380;
          const g = ctx.createGain();
          o.connect(lp).connect(g).connect(this.sfx);
          g.gain.setValueAtTime(0.0001, t + at);
          g.gain.exponentialRampToValueAtTime(0.1, t + at + 0.03);
          g.gain.setValueAtTime(0.1, t + at + 0.26);
          g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.32);
          o.start(t + at);
          o.stop(t + at + 0.35);
        }
        break;
      }
      case 'notify':
      case 'send': {
        if (id === 'notify' && this.samples.play(ctx, this.sfx, 'notify', 0.4)) break;
        // Discreet: two soft sine notes.
        const notes = id === 'notify' ? [1318.5, 1760] : [880, 1174.7];
        notes.forEach((fq, i) => {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = fq;
          const g = ctx.createGain();
          o.connect(g);
          g.connect(this.sfx);
          g.connect(this.reverbSend);
          const s0 = t + i * 0.11;
          g.gain.setValueAtTime(0.0001, s0);
          g.gain.exponentialRampToValueAtTime(id === 'notify' ? 0.045 : 0.03, s0 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.5);
          o.start(s0);
          o.stop(s0 + 0.55);
        });
        break;
      }
      case 'swing':
        // A distant swing — chain and pivot, twice, as if pushed.
        this.creak(1.7, 0.09);
        this.creakAt(1.25, 1.55, 0.07);
        break;
      case 'branch': {
        const n = this.noise();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1800;
        const g = ctx.createGain();
        n.connect(hp).connect(g);
        g.connect(this.sfx);
        g.connect(this.reverbSend);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        n.start(t, Math.random(), 0.3);
        this.creakAt(0.15, 2.4, 0.05);
        break;
      }
      case 'flicker': {
        // The lamp's ballast stutters.
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 118;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 3;
        const g = ctx.createGain();
        o.connect(bp).connect(g).connect(this.sfx);
        g.gain.setValueAtTime(0.0001, t);
        for (let i = 0; i < 6; i++) g.gain.setValueAtTime(i % 2 ? 0.0001 : 0.03, t + i * 0.13 + Math.random() * 0.05);
        g.gain.setValueAtTime(0.0001, t + 0.9);
        o.start(t);
        o.stop(t + 1);
        break;
      }
      case 'grass':
        this.rustle(2.2);
        this.whoosh();
        break;
    }
  }

  /** A creak scheduled on the audio clock (no timers). */
  private creakAt(delay: number, pitch: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(70 * pitch, t);
    o.frequency.linearRampToValueAtTime(130 * pitch, t + 0.6);
    o.frequency.linearRampToValueAtTime(95 * pitch, t + 1.3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 6;
    const g = ctx.createGain();
    o.connect(f).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverbSend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.start(t);
    o.stop(t + 1.6);
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

  private creak(pitch = 1, vol = 0.22): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(70 * pitch, t);
    o.frequency.linearRampToValueAtTime(130 * pitch, t + 0.6);
    o.frequency.linearRampToValueAtTime(95 * pitch, t + 1.3);
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
    this.env(g, vol, 0.2, 1.2);
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

  private impact(by: CatchCause): void {
    this.thud(by === 'branch' ? 60 : 80, 0.5);
    // Heartbeat.
    setTimeout(() => this.thud(45, 0.4), 260);
    setTimeout(() => this.thud(42, 0.3), 480);
    if (by === 'grass') this.rustle(0.5);
    if (by === 'water') this.splash(0.3);
    if (by === 'fire') this.embersHiss(0.5);
  }

  // ---------- Stage 2: the Demon's elements ----------

  /** A gust: band-passed noise swelling and sweeping upward. */
  private howl(dur: number, vol: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur * 0.6);
    f.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g = ctx.createGain();
    n.connect(f).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverbSend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.start(t, Math.random() * 1.2, dur + 0.1);
  }

  /** Water gathering: irregular low bubbles. */
  private gurgle(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 9; i++) {
      setTimeout(() => {
        const o = ctx.createOscillator();
        const t = ctx.currentTime;
        const f0 = 180 + Math.random() * 260;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.06);
        const g = ctx.createGain();
        o.connect(g).connect(this.sfx);
        this.env(g, 0.05, 0.004, 0.07);
        o.start();
        o.stop(t + 0.1);
      }, i * 110 + Math.random() * 80);
    }
  }

  private splash(vol: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, vol, 0.01, 0.5);
    n.start(ctx.currentTime, Math.random(), 0.6);
  }

  /** The fountain erupting: a roar that settles into hiss. */
  private fountain(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    n.connect(f).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverbSend);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.start(t, Math.random(), 1.5);
    this.thud(65, 0.3);
  }

  /** Pale embers: a thin, cold crackle. */
  private embersHiss(vol = 0.1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        const n = this.noise();
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 3000 + Math.random() * 4000;
        f.Q.value = 8;
        const g = ctx.createGain();
        n.connect(f).connect(g).connect(this.sfx);
        this.env(g, vol, 0.002, 0.04);
        n.start(ctx.currentTime, Math.random() * 2, 0.06);
      }, i * 90 + Math.random() * 60);
    }
  }

  /** Cold fire catching: an inhaled whoosh with a glassy shimmer, not an explosion. */
  private ignite(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.4);
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.start(t, Math.random(), 2);
    for (const fr of [1318, 1975]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr * (1 + (Math.random() - 0.5) * 0.01);
      const og = ctx.createGain();
      o.connect(og);
      og.connect(this.reverbSend);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.025, t + 0.3);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.start();
      o.stop(t + 2.3);
    }
  }

  /** The flames sinking into ash. */
  private ashCollapse(): void {
    this.thud(48, 0.2);
    this.embersHiss(0.06);
  }

  /** A clean dodge: a soft rising breath of relief. */
  private relief(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(392, t);
    o.frequency.exponentialRampToValueAtTime(587, t + 0.22);
    const g = ctx.createGain();
    o.connect(g);
    g.connect(this.sfx);
    g.connect(this.reverbSend);
    this.env(g, 0.045, 0.02, 0.6);
    o.start();
    o.stop(t + 0.7);
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const ng = ctx.createGain();
    n.connect(f).connect(ng).connect(this.sfx);
    this.env(ng, 0.04, 0.05, 0.25);
    n.start(t, Math.random(), 0.35);
  }

  /** A single distant bell. */
  private bell(freq: number, vol: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [mult, amp] of [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.2],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * mult;
      const g = ctx.createGain();
      o.connect(g);
      g.connect(this.reverbSend);
      g.connect(this.amb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 / mult + 0.5);
      o.start();
      o.stop(t + 4.2);
    }
  }

  /** Lamps conferring: an electrical hum that rises and falls. */
  private hum(): void {
    if (!this.ctx || this.peace) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 100;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 400;
    f.Q.value = 4;
    const g = ctx.createGain();
    o.connect(f).connect(g).connect(this.sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.start();
    o.stop(t + 2.7);
  }

  /** The Demon's mood darkens: a long low swell. */
  private phaseShift(level: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(41.2 / level, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    g.connect(this.amb);
    g.connect(this.reverbSend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    o.start();
    o.stop(t + 5.2);
    this.bell(55, 0.15);
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
