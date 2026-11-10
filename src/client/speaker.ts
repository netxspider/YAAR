import { stripTags } from "@/lib/text";
import type { LanguagePref } from "@/lib/types";

interface VoiceSettings {
  voice: string;
  language: LanguagePref;
  speed: number;
}

interface SpeakerEvents {
  /** A sentence has started playing (or, if voice failed, is being shown). */
  onSentence(text: string): void;
  /** Everything queued has finished playing. */
  onEnd(): void;
  onVoiceError(): void;
}

/**
 * Turns reply sentences into gapless audio as they stream in. Each sentence is
 * fetched from Timbre while the previous one plays, and the whole queue can be
 * dropped instantly when the user interrupts.
 */
export class Speaker {
  readonly analyser: AnalyserNode;
  private output: GainNode;
  private queue: string[] = [];
  private closed = true;
  private pumping = false;
  private generation = 0;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private abort: AbortController | null = null;
  private started: string[] = [];

  constructor(
    private ctx: AudioContext,
    private settings: () => VoiceSettings,
    private events: SpeakerEvents,
  ) {
    this.output = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this.output.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  get active(): boolean {
    return !this.closed || this.pumping || this.ctx.currentTime < this.nextTime;
  }

  /** Starts a new reply, discarding anything still playing. */
  begin() {
    this.stop();
    this.closed = false;
  }

  push(sentence: string) {
    if (this.closed) return;
    this.queue.push(sentence);
    void this.pump();
  }

  /** No more sentences are coming for this reply. */
  close() {
    this.closed = true;
    void this.pump();
  }

  /** Cuts playback now and returns what the user actually heard. */
  stop(): string[] {
    this.generation += 1;
    this.queue = [];
    this.closed = true;
    this.abort?.abort();
    this.abort = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.nextTime = 0;
    const heard = this.started;
    this.started = [];
    this.pumping = false;
    return heard;
  }

  private at(time: number, run: () => void) {
    const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, delay);
    this.timers.add(timer);
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    const generation = this.generation;

    while (this.queue.length && generation === this.generation) {
      const sentence = this.queue.shift()!;
      const ok = await this.play(sentence, generation);
      if (!ok && generation === this.generation) {
        // Voice failed: still show the words so the conversation continues.
        this.events.onVoiceError();
        this.at(this.nextTime, () => {
          this.started.push(sentence);
          this.events.onSentence(stripTags(sentence));
        });
      }
    }

    if (generation !== this.generation) return;
    this.pumping = false;
    if (this.closed && !this.queue.length) {
      this.at(this.nextTime + 0.05, () => {
        if (generation === this.generation && !this.pumping && this.closed && !this.queue.length) {
          this.started = [];
          this.events.onEnd();
        }
      });
    }
  }

  private async play(sentence: string, generation: number): Promise<boolean> {
    const settings = this.settings();
    for (let attempt = 0; attempt < 2; attempt++) {
      this.abort = new AbortController();
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sentence, ...settings }),
          signal: this.abort.signal,
        });
        if (!response.ok || !response.body) throw new Error(String(response.status));
        const rate = Number(response.headers.get("X-Sample-Rate")) || 24000;
        await this.stream(response.body, rate, sentence, generation);
        return true;
      } catch {
        if (generation !== this.generation) return true;
      }
    }
    return false;
  }

  private async stream(body: ReadableStream<Uint8Array>, rate: number, sentence: string, generation: number) {
    const reader = body.getReader();
    let carry: Uint8Array | null = null;
    let first = true;

    for (;;) {
      const { done, value } = await reader.read();
      if (generation !== this.generation) {
        await reader.cancel().catch(() => {});
        return;
      }
      if (done) break;

      let bytes = value;
      if (carry) {
        bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
        carry = null;
      }
      if (bytes.length % 2) {
        carry = bytes.slice(-1);
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      if (!bytes.length) continue;

      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
      const buffer = this.ctx.createBuffer(1, samples.length, rate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

      const now = this.ctx.currentTime;
      // A small lead keeps playback smooth; a pause between sentences sounds human.
      if (this.nextTime < now + 0.04) this.nextTime = now + (first ? 0.08 : 0.04);
      else if (first) this.nextTime += 0.12;

      if (first) {
        first = false;
        // Count a sentence as heard only once it actually starts playing.
        this.at(this.nextTime, () => {
          this.started.push(sentence);
          this.events.onSentence(stripTags(sentence));
        });
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output);
      source.onended = () => this.sources.delete(source);
      source.start(this.nextTime);
      this.sources.add(source);
      this.nextTime += buffer.duration;
    }
  }
}
