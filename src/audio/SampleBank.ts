/**
 * Optional recorded sounds. The game is fully synthesized by default; any
 * sample listed in /audio/samples.json (and present on disk) is used in
 * place of its synthesized counterpart. Every entry must carry its licence
 * and source — see public/audio/README.md.
 */
export interface SampleEntry {
  url: string;
  gain?: number;
  license: string;
  source: string;
  author?: string;
}

export type SampleId = 'laugh' | 'notify' | 'footstep' | 'evening' | 'park' | 'owl';

export class SampleBank {
  private buffers = new Map<SampleId, AudioBuffer[]>();
  private gains = new Map<SampleId, number>();

  /** Load whatever the manifest lists; missing or broken files are skipped silently. */
  async load(ctx: AudioContext, base: string): Promise<void> {
    let manifest: Partial<Record<SampleId, SampleEntry | SampleEntry[]>>;
    try {
      const r = await fetch(base + 'audio/samples.json');
      if (!r.ok) return;
      manifest = await r.json();
    } catch {
      return;
    }
    for (const [id, value] of Object.entries(manifest) as Array<[SampleId, SampleEntry | SampleEntry[]]>) {
      const entries = Array.isArray(value) ? value : [value];
      const bufs: AudioBuffer[] = [];
      for (const e of entries) {
        if (!e.license || !e.source) continue; // no provenance, no playback
        try {
          const data = await (await fetch(base + e.url)).arrayBuffer();
          bufs.push(await ctx.decodeAudioData(data));
          this.gains.set(id, e.gain ?? 1);
        } catch {
          /* skip */
        }
      }
      if (bufs.length) this.buffers.set(id, bufs);
    }
  }

  has(id: SampleId): boolean {
    return this.buffers.has(id);
  }

  /** Play a random variant; returns false when there's no sample (use the synth instead). */
  play(ctx: AudioContext, dest: AudioNode, id: SampleId, gain = 1, rate = 1): boolean {
    const list = this.buffers.get(id);
    if (!list) return false;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain * (this.gains.get(id) ?? 1);
    src.connect(g).connect(dest);
    src.start();
    return true;
  }
}
