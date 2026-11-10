export type VadEvent = "start" | "end" | null;

/**
 * Energy-based voice activity detection with an adaptive noise floor.
 * While the companion is talking it becomes "guarded": it needs louder, longer
 * speech before it counts, so echo from the speaker doesn't interrupt the reply.
 */
export class Vad {
  noise = 0.004;
  speaking = false;
  private voicedMs = 0;
  private silentMs = 0;

  private options = { floor: 0.012, guardedFloor: 0.03, startMs: 140, guardedStartMs: 260, hangMs: 900 };

  threshold(guarded: boolean): number {
    return guarded
      ? Math.max(this.options.guardedFloor, this.noise * 5)
      : Math.max(this.options.floor, this.noise * 3.2);
  }

  step(rms: number, ms: number, guarded = false): VadEvent {
    const threshold = this.threshold(guarded);

    if (!this.speaking) {
      // Never learn the floor from the companion's own echo.
      if (!guarded && rms < threshold) this.noise += (rms - this.noise) * (rms < this.noise ? 0.2 : 0.02);
      // Speech dips between syllables, so quiet frames only slowly undo progress.
      this.voicedMs = rms > threshold ? this.voicedMs + ms : Math.max(0, this.voicedMs - ms * 0.75);
      if (this.voicedMs >= (guarded ? this.options.guardedStartMs : this.options.startMs)) {
        this.speaking = true;
        this.silentMs = 0;
        return "start";
      }
      return null;
    }

    // Hysteresis: once someone is talking, softer sounds still count as talking.
    this.silentMs = rms < threshold * 0.6 ? this.silentMs + ms : 0;
    if (this.silentMs >= this.options.hangMs) {
      this.speaking = false;
      this.voicedMs = 0;
      return "end";
    }
    return null;
  }

  reset() {
    this.speaking = false;
    this.voicedMs = 0;
    this.silentMs = 0;
  }
}
