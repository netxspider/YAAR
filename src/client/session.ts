import { Speaker } from "./speaker";
import { store } from "./store";
import { encodeWav, rms } from "./wav";
import { applyOps, retrieve } from "@/lib/memory";
import { SentenceChunker, stripTags } from "@/lib/text";
import { Vad } from "@/lib/vad";
import type { ChatEvent, ChatRequest, Conversation, Memory, MemoryOps, Mood, Profile, Turn } from "@/lib/types";

export type Phase = "off" | "listening" | "hearing" | "thinking" | "speaking";

export interface Snapshot {
  phase: Phase;
  micOn: boolean;
  micAvailable: boolean;
  mood: Mood;
  /** What the user said last, and what the companion is saying now. */
  heard: string;
  saying: string;
  crisis: boolean;
  notice: string | null;
  turns: Turn[];
}

const PRE_ROLL_MS = 450;
const SEGMENT_MS = 28_000;
const MIN_SPEECH_MS = 300;

const uid = () => crypto.randomUUID();

function localTime(): string {
  return new Date().toLocaleString("en-IN", { weekday: "long", hour: "numeric", minute: "2-digit", day: "numeric", month: "long" });
}

/**
 * The conversation engine: microphone → Prisma → reasoning model → Timbre.
 * Owns turn-taking, barge-in and memory so the React layer only renders.
 */
export class Session {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private speaker: Speaker | null = null;
  private stream: MediaStream | null = null;
  private micLevel = 0;
  private vad = new Vad();
  private frames: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private segments: Promise<string>[] = [];
  private captureMs = 0;
  private chatAbort: AbortController | null = null;
  private chatGeneration = 0;
  /** Words from a turn the user kept talking over, merged into the next one. */
  private carry = "";
  private reply = { full: "", spoken: [] as string[], id: "" };
  private conversation: Conversation;
  private memories: Memory[];
  private userTurnsSinceMemory = 0;
  private memoryBusy = false;
  private freq = new Uint8Array(256);
  /** Language Prisma heard in longer utterances; short ones are easy to misjudge. */
  private languageHint: string | null = null;

  constructor(public profile: Profile) {
    this.conversation = { id: uid(), startedAt: Date.now(), turns: [] };
    this.memories = store.memories();
    this.snapshot = {
      phase: "off",
      micOn: true,
      micAvailable: true,
      mood: "neutral",
      heard: "",
      saying: "",
      crisis: false,
      notice: null,
      turns: [],
    };
  }

  // ---- React bindings -------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Audio energy for the particle ball, read every animation frame. */
  levels(): { level: number; bass: number; treble: number } {
    const phase = this.snapshot.phase;
    if (phase === "speaking" && this.speaker) {
      const analyser = this.speaker.analyser;
      analyser.getByteFrequencyData(this.freq);
      const bins = analyser.frequencyBinCount;
      let bass = 0;
      let mid = 0;
      let treble = 0;
      const a = Math.floor(bins * 0.06);
      const b = Math.floor(bins * 0.3);
      for (let i = 0; i < bins; i++) {
        const v = this.freq[i] / 255;
        if (i < a) bass += v;
        else if (i < b) mid += v;
        else treble += v;
      }
      bass /= a;
      mid /= b - a;
      treble /= bins - b;
      return { level: Math.min(1, mid * 1.6 + bass * 0.4), bass, treble: Math.min(1, treble * 3) };
    }
    if (phase === "hearing" || phase === "listening") {
      const level = Math.min(1, this.micLevel * 9);
      return { level, bass: level * 0.5, treble: 0 };
    }
    return { level: 0, bass: 0, treble: 0 };
  }

  // ---- Lifecycle -----------------------------------------------------------

  /** Must be called from a tap: browsers only allow audio after a gesture. */
  async start() {
    if (this.snapshot.phase !== "off") return;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.resume();
    this.speaker = new Speaker(
      ctx,
      () => ({
        voice: this.previewVoice ?? this.profile.companion.voice,
        language: this.profile.language,
        speed: this.profile.speed,
      }),
      {
        onSentence: (text) => this.onSentence(text),
        onEnd: () => this.onReplyEnd(),
        onVoiceError: () => this.set({ notice: "Voice is having trouble, so I'm showing the words." }),
      },
    );
    this.set({ phase: "thinking" });
    void this.openMic();
    void this.respond(true);
  }

  private async openMic() {
    if (!this.ctx) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      await this.ctx.audioWorklet.addModule("/worklets/capture.js");
      const source = this.ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(this.ctx, "yaar-capture");
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(this.ctx.destination);
      node.port.onmessage = (event) => this.onFrame(event.data as Float32Array);
    } catch {
      this.set({ micAvailable: false, micOn: false, notice: "No mic access, so let's type. You can allow the mic in your browser's site settings." });
    }
  }

  stop() {
    this.chatAbort?.abort();
    this.speaker?.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.save();
  }

  setMic(on: boolean) {
    if (!this.snapshot.micAvailable) return;
    if (!on && this.vad.speaking) {
      this.vad.reset();
      this.frames = [];
      this.set({ phase: this.speaker?.active ? "speaking" : "listening" });
    }
    this.set({ micOn: on });
  }

  dismissCrisis = () => this.set({ crisis: false });
  dismissNotice = () => this.set({ notice: null });

  updateProfile(profile: Profile) {
    this.profile = profile;
    store.saveProfile(profile);
  }

  setMemories(memories: Memory[]) {
    this.memories = memories;
    store.saveMemories(memories);
  }

  /** A short spoken sample for the voice picker. */
  preview(voice: string) {
    if (!this.speaker) return;
    this.interrupt();
    this.previewing = true;
    this.previewVoice = voice;
    this.speaker.begin();
    this.speaker.push(`Hi, main ${this.profile.companion.name}. Aisi lagti hai meri awaaz.`);
    this.speaker.close();
  }
  private previewing = false;
  private previewVoice: string | null = null;
  private awaitingReply = false;

  // ---- Listening -----------------------------------------------------------

  private onFrame(frame: Float32Array) {
    if (!this.ctx) return;
    const ms = (frame.length / this.ctx.sampleRate) * 1000;
    const level = rms(frame);
    this.micLevel = this.micLevel * 0.6 + level * 0.4;
    if (!this.snapshot.micOn || this.snapshot.phase === "off") return;

    if (!this.vad.speaking) {
      this.preRoll.push(frame);
      while (this.preRoll.length * ms > PRE_ROLL_MS) this.preRoll.shift();
    } else {
      this.frames.push(frame);
      this.captureMs += ms;
      if (this.captureMs >= SEGMENT_MS) this.flushSegment();
    }

    const event = this.vad.step(level, ms, this.snapshot.phase === "speaking");
    if (event === "start") this.onSpeechStart();
    if (event === "end") void this.onSpeechEnd();
  }

  private onSpeechStart() {
    const phase = this.snapshot.phase;
    if (phase === "speaking") this.interrupt();
    else if (phase === "thinking") this.holdThought();
    this.frames = [...this.preRoll];
    this.preRoll = [];
    this.captureMs = 0;
    this.segments = [];
    this.set({ phase: "hearing", heard: "" });
  }

  /** Long venting is split into ≤30 s pieces, transcribed while they keep talking. */
  private flushSegment() {
    const frames = this.frames;
    this.frames = [];
    this.captureMs = 0;
    const previous = this.segments.at(-1) ?? Promise.resolve("");
    this.segments.push(previous.then((before) => this.transcribe(frames, before)));
  }

  private async onSpeechEnd() {
    const frames = this.frames;
    const spokenMs = this.captureMs;
    this.frames = [];
    this.captureMs = 0;
    const segments = this.segments;
    this.segments = [];

    if (!segments.length && spokenMs < MIN_SPEECH_MS) {
      this.set({ phase: this.speaker?.active ? "speaking" : "listening" });
      return;
    }

    this.set({ phase: "thinking" });
    const before = await Promise.all(segments);
    const last = await this.transcribe(frames, before.at(-1) ?? "");
    const text = [...before, last].join(" ").replace(/\s+/g, " ").trim();

    if (this.vad.speaking) {
      // They started talking again while we were transcribing.
      this.carry = `${this.carry} ${text}`.trim();
      return;
    }
    if (!text) {
      if (this.carry) return this.sendUser("");
      this.set({ phase: "listening" });
      return;
    }
    this.sendUser(text);
  }

  private async transcribe(frames: Float32Array[], previousText: string): Promise<string> {
    if (!this.ctx || !frames.length) return "";
    const form = new FormData();
    form.set("audio", encodeWav(frames, this.ctx.sampleRate), "speech.wav");
    form.set("language", this.sttLanguage());
    form.set("keyterms", [this.profile.companion.name, this.profile.user.name, "YAAR"].filter(Boolean).join(","));
    if (previousText) form.set("previousText", previousText.slice(-600));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch("/api/stt", { method: "POST", body: form });
        if (!response.ok) throw new Error(String(response.status));
        const result = (await response.json()) as { text?: string; language?: string };
        const text = String(result.text ?? "");
        if (result.language && text.length >= 20) this.languageHint = result.language;
        return text;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    this.set({ notice: "Couldn't catch that. Mind saying it again, or typing it?" });
    return "";
  }

  /**
   * In auto mode the first long sentence decides the language; after that,
   * Prisma chooses between it, Hindi and English instead of all of India's.
   */
  private sttLanguage(): string {
    if (this.profile.language !== "auto") return this.profile.language;
    if (!this.languageHint) return "auto";
    return [...new Set([this.languageHint, "hi-IN", "en-IN"])].join(",");
  }

  // ---- Talking -------------------------------------------------------------

  sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.snapshot.phase === "speaking") this.interrupt();
    else if (this.snapshot.phase === "thinking") this.holdThought();
    this.sendUser(trimmed);
  }

  private sendUser(text: string) {
    const combined = `${this.carry} ${text}`.trim();
    this.carry = "";
    if (!combined) return;
    this.addTurn({ id: uid(), role: "user", text: combined, at: Date.now() });
    this.userTurnsSinceMemory += 1;
    this.set({ heard: combined, saying: "" });
    void this.respond(false);
  }

  /** Stops the companion mid-sentence and keeps only what was actually heard. */
  interrupt() {
    if (!this.speaker) return;
    this.chatAbort?.abort();
    this.chatGeneration += 1;
    const heard = this.speaker.stop();
    if (this.previewing) {
      this.previewing = false;
      this.previewVoice = null;
    } else if (heard.length && this.reply.id) {
      this.addTurn({
        id: this.reply.id,
        role: "companion",
        text: stripTags(heard.join(" ")),
        at: Date.now(),
        mood: this.snapshot.mood,
        interrupted: true,
      });
    }
    this.reply = { full: "", spoken: [], id: "" };
    if (this.snapshot.phase === "speaking") this.set({ phase: "listening" });
  }

  /**
   * The user kept going before the reply started. Withdraw their last turn and
   * the half-formed answer, and fold it into what they say next.
   */
  private holdThought() {
    this.chatAbort?.abort();
    this.chatGeneration += 1;
    this.speaker?.stop();
    this.reply = { full: "", spoken: [], id: "" };
    if (!this.awaitingReply) return;
    this.awaitingReply = false;
    const turns = this.conversation.turns;
    const last = turns.at(-1);
    if (last?.role === "user") {
      turns.pop();
      this.carry = `${last.text} ${this.carry}`.trim();
      this.set({ turns: [...turns] });
    }
  }

  private buildRequest(opening: boolean): ChatRequest {
    const turns = this.conversation.turns.slice(-20);
    const lastUser = [...turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
    const context = `${lastUser} ${turns.slice(-4).map((t) => t.text).join(" ")}`;
    const memories = this.profile.memoryEnabled ? retrieve(this.memories, context) : [];

    let lastSession: ChatRequest["lastSession"];
    const previous = store.conversations().find((c) => c.id !== this.conversation.id);
    if (previous && this.conversation.turns.length < 8) {
      const tail = previous.turns.slice(-6);
      lastSession = { endedAt: tail.at(-1)?.at ?? previous.startedAt, turns: tail.map(({ role, text }) => ({ role, text })) };
    }

    return {
      profile: this.profile,
      turns: turns.map(({ role, text, interrupted }) => ({ role, text, interrupted })),
      memories: memories.map(({ category, text, basis, createdAt }) => ({ category, text, basis, createdAt })),
      lastSession,
      localTime: localTime(),
      opening,
    };
  }

  private async respond(opening: boolean) {
    if (!this.speaker) return;
    this.chatAbort?.abort();
    const abort = new AbortController();
    this.chatAbort = abort;
    const generation = ++this.chatGeneration;
    this.reply = { full: "", spoken: [], id: uid() };
    this.speaker.begin();
    this.awaitingReply = !opening;
    this.set({ phase: "thinking", notice: null });

    const chunker = new SentenceChunker();
    const current = () => generation === this.chatGeneration;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequest(opening)),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`chat ${response.status}`);

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !current()) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.t === "read") this.set({ mood: event.read.certainty >= 0.35 ? event.read.mood : "neutral" });
          if (event.t === "crisis") this.set({ crisis: true });
          if (event.t === "error") throw new Error(event.message);
          if (event.t === "delta") {
            this.reply.full += event.text;
            for (const sentence of chunker.push(event.text)) this.speaker.push(sentence);
          }
        }
      }
      if (!current()) return;
      const tail = chunker.flush();
      if (tail) this.speaker.push(tail);
      if (!this.reply.full.trim()) throw new Error("empty");
      this.speaker.close();
    } catch (error) {
      if (abort.signal.aborted || !current()) return;
      this.awaitingReply = false;
      this.speaker.stop();
      const reason = error instanceof Error ? error.message : "";
      this.set({
        phase: "listening",
        notice:
          reason === "not_configured"
            ? "My brain isn't connected yet: add a model key to .env.local (see README)."
            : "Lost my train of thought for a second. Say that again?",
      });
    }
  }

  private onSentence(text: string) {
    if (!text) return;
    this.awaitingReply = false;
    const saying = this.snapshot.phase === "speaking" ? `${this.snapshot.saying} ${text}`.trim() : text;
    this.set({ phase: "speaking", saying });
  }

  private onReplyEnd() {
    if (this.previewing) {
      this.previewing = false;
      this.previewVoice = null;
      this.set({ phase: "listening" });
      return;
    }
    const text = stripTags(this.reply.full);
    if (text && this.reply.id) {
      this.addTurn({ id: this.reply.id, role: "companion", text, at: Date.now(), mood: this.snapshot.mood });
    }
    this.reply = { full: "", spoken: [], id: "" };
    this.set({ phase: this.vad.speaking ? "hearing" : "listening" });
    if (this.userTurnsSinceMemory >= 2) void this.updateMemory();
  }

  private addTurn(turn: Turn) {
    const turns = this.conversation.turns;
    const existing = turns.findIndex((t) => t.id === turn.id);
    if (existing >= 0) turns[existing] = turn;
    else turns.push(turn);
    this.set({ turns: [...turns] });
    this.save();
  }

  private save() {
    store.saveConversation(this.conversation);
  }

  persist = () => this.save();

  // ---- Memory --------------------------------------------------------------

  private async updateMemory() {
    if (!this.profile.memoryEnabled || this.memoryBusy) return;
    this.memoryBusy = true;
    this.userTurnsSinceMemory = 0;
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turns: this.conversation.turns.slice(-12).map(({ role, text }) => ({ role, text })),
          memories: this.memories.map(({ id, text }) => ({ id, text })),
        }),
      });
      const ops = (await response.json()) as MemoryOps;
      if (ops.add?.length || ops.update?.length || ops.remove?.length) {
        // Re-read in case the user edited memories while this was running.
        this.setMemories(applyOps(store.memories(), ops));
      }
    } catch {
      // Best-effort.
    } finally {
      this.memoryBusy = false;
    }
  }
}
