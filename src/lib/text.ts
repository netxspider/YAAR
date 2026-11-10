import type { LanguagePref, Mood, Read, Want } from "./types.ts";

const MOODS: Mood[] = ["neutral", "warm", "joy", "low", "anxious", "angry"];
const WANTS: Want[] = ["heard", "comfort", "chat", "advice", "think", "distract", "laugh", "help", "deep"];

export const ALLOWED_TAGS = ["laugh", "giggle", "sigh", "exhales", "whispers", "excited", "slow", "pauses"];
const OPEN = "<read>";
const CLOSE = "</read>";

export function parseRead(raw: string): Read | null {
  try {
    const value = JSON.parse(raw);
    return {
      mood: MOODS.includes(value.mood) ? value.mood : "neutral",
      certainty: Math.min(1, Math.max(0, Number(value.certainty) || 0)),
      wants: WANTS.includes(value.wants) ? value.wants : "chat",
    };
  } catch {
    return null;
  }
}

/**
 * Separates the model's hidden <read>…</read> preface from the spoken reply as
 * tokens arrive, without holding back the reply once it has started.
 */
export class ReadSplitter {
  private buffer = "";
  private phase: "start" | "inside" | "reply" = "start";

  push(delta: string): { read?: Read; text: string } {
    if (this.phase === "reply") return { text: delta };
    this.buffer += delta;

    if (this.phase === "start") {
      const trimmed = this.buffer.trimStart();
      if (trimmed.startsWith(OPEN)) {
        this.phase = "inside";
      } else if (trimmed.length >= OPEN.length || !OPEN.startsWith(trimmed)) {
        // The model skipped the preface, so treat everything as reply.
        this.phase = "reply";
        const text = this.buffer;
        this.buffer = "";
        return { text };
      } else {
        return { text: "" };
      }
    }

    const end = this.buffer.indexOf(CLOSE);
    if (end === -1) return { text: "" };
    const inner = this.buffer.slice(this.buffer.indexOf(OPEN) + OPEN.length, end);
    const rest = this.buffer.slice(end + CLOSE.length).replace(/^\s+/, "");
    this.phase = "reply";
    this.buffer = "";
    return { read: parseRead(inner) ?? undefined, text: rest };
  }

  /** Whatever is left when the stream ends. An unfinished preface is dropped. */
  flush(): string {
    if (this.phase === "start") {
      const text = this.buffer;
      this.buffer = "";
      return text;
    }
    return "";
  }
}

const TAG_PATTERN = /<\s*\/?\s*[a-zA-Z][a-zA-Z _-]*\s*>/g;

/** Text for the transcript: no audio tags, no leftover markup. */
export function stripTags(text: string): string {
  return text
    .replace(TAG_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.?!।])/g, "$1")
    .trim();
}

/** Text for Timbre: keep only tags it understands, and never send tags alone. */
export function cleanForSpeech(text: string): string {
  const cleaned = text
    .replace(TAG_PATTERN, (tag) => {
      const name = tag.replace(/[<>/\s]/g, "").toLowerCase();
      return ALLOWED_TAGS.includes(name) ? `<${name}>` : "";
    })
    .replace(/[*_#`~]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripTags(cleaned).length > 0 ? cleaned : "";
}

const SENTENCE_END = /[.?!।॥\n]+["'”’)]*(?=\s|$)/g;

/**
 * Cuts a streaming reply into natural speech chunks so the first sentence can
 * be voiced while the rest is still being written. Very short fragments like
 * "Ouch." are held and merged forward so the delivery does not sound clipped.
 */
export class SentenceChunker {
  private buffer = "";
  private minLength: number;

  constructor(minLength = 14) {
    this.minLength = minLength;
  }

  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];
    let start = 0;
    for (const match of this.buffer.matchAll(SENTENCE_END)) {
      const end = match.index + match[0].length;
      // A boundary at the very end of the buffer may still grow ("Hmm..." or "3.5").
      if (end >= this.buffer.length && !match[0].includes("\n") && !/[?!।]$/.test(match[0])) continue;
      const piece = this.buffer.slice(start, end).trim();
      if (stripTags(piece).length < this.minLength) continue;
      chunks.push(piece);
      start = end;
    }
    this.buffer = this.buffer.slice(start);
    return chunks;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest || null;
  }
}

const OTHER_INDIC = /[ঀ-૿஀-ൿ]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[a-zA-Z]/;
// Common romanized Hindi words, used to tell Hinglish from plain English.
const ROMAN_HINDI = /\b(hai|hain|hoon|kya|nahi|nahin|yaar|tum|tumhe|mujhe|acha|accha|aaj|kuch|kaise|kaisa|kaisi|bahut|thoda|batao|matlab|arre|haan|toh|raha|rahi)\b/i;

/** Chooses Timbre's language so script and language agree. */
export function ttsLanguage(text: string, pref: LanguagePref): string {
  if (pref !== "auto" && pref !== "hi-IN") return pref;
  if (OTHER_INDIC.test(text)) return "auto";
  if (DEVANAGARI.test(text)) return LATIN.test(text) ? "hi-en" : "hi-IN";
  if (pref === "hi-IN" || ROMAN_HINDI.test(text)) return "hi-en";
  return "en-IN";
}

const CRISIS_PATTERNS = [
  /\b(kill|killing|hurt|hurting|harm|harming)\s+my\s*self\b/i,
  /\bsuicid(e|al)\b/i,
  /\bself[\s-]?harm\b/i,
  /\bend(ing)?\s+(my\s+(own\s+)?life|it\s+all)\b/i,
  /\b(want|wanna|going)\s+to\s+die\b/i,
  /\bwanna\s+die\b/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living)\b/i,
  /\bbetter\s+off\s+(dead|without\s+me)\b/i,
  /\bcut(ting)?\s+my\s*(self|wrists?)\b/i,
  /\b(khudkushi|aatmahatya|atmahatya)\b/i,
  /\bmar(na)?\s+(jaana\s+)?(chahta|chahti)\b/i,
  /\bjeena\s+nahi(n)?\s+(chahta|chahti)\b/i,
  /\bjee\s+nahi(n)?\s+(sakta|sakti)\b/i,
  /\bzind(a|agi)\s+(nahi(n)?\s+rehna|khatam)\b/i,
  /आत्महत्या|ख़ुदकुशी|खुदकुशी/,
  /मरना\s*(चाहता|चाहती)|मर\s*जाना\s*(चाहता|चाहती)/,
  /जीना\s*नहीं\s*(चाहता|चाहती)|जी\s*नहीं\s*(सकता|सकती)/,
  /ज़िंदगी\s*(ख़त्म|खत्म)|जिंदगी\s*(ख़त्म|खत्म)/,
];

/** A cheap, conservative net that runs before the model does. Not a diagnosis. */
export function detectCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((pattern) => pattern.test(text));
}

/** Removes <think>…</think> reasoning from a token stream, even when tags split across tokens. */
export class ThinkStripper {
  private buffer = "";
  private inside = false;

  push(delta: string): string {
    this.buffer += delta;
    let out = "";
    for (;;) {
      const tag = this.inside ? "</think>" : "<think>";
      const at = this.buffer.indexOf(tag);
      if (at !== -1) {
        if (!this.inside) out += this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + tag.length);
        this.inside = !this.inside;
        continue;
      }
      // Hold back a possible partial tag at the end of the buffer.
      let keep = 0;
      for (let n = Math.min(tag.length - 1, this.buffer.length); n > 0; n--) {
        if (tag.startsWith(this.buffer.slice(-n))) {
          keep = n;
          break;
        }
      }
      if (!this.inside) out += this.buffer.slice(0, this.buffer.length - keep);
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      return out;
    }
  }
}
