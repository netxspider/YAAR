export type Gender = "female" | "male" | "neutral";

export type LanguagePref =
  | "auto"
  | "hi-IN"
  | "en-IN"
  | "mr-IN"
  | "bn-IN"
  | "gu-IN"
  | "pa-IN"
  | "ta-IN"
  | "te-IN"
  | "kn-IN"
  | "ml-IN";

export interface Profile {
  companion: { name: string; gender: Gender; age: number; voice: string };
  user: { name: string; gender: Gender };
  memoryEnabled: boolean;
  language: LanguagePref;
  speed: number;
  createdAt: number;
}

export type Mood = "neutral" | "warm" | "joy" | "low" | "anxious" | "angry";

export type Want =
  | "heard"
  | "comfort"
  | "chat"
  | "advice"
  | "think"
  | "distract"
  | "laugh"
  | "help"
  | "deep";

/** The companion's private, uncertain read of the moment. Never shown as a label. */
export interface Read {
  mood: Mood;
  certainty: number;
  wants: Want;
}

export interface Turn {
  id: string;
  role: "user" | "companion";
  text: string;
  at: number;
  mood?: Mood;
  /** True when the user cut this reply off, so `text` is only what was actually said. */
  interrupted?: boolean;
}

export interface Conversation {
  id: string;
  startedAt: number;
  turns: Turn[];
}

export type MemoryCategory = "about" | "people" | "life" | "preference";

export interface Memory {
  id: string;
  category: MemoryCategory;
  text: string;
  /** The user's own words, kept so the original context survives. */
  quote?: string;
  /** "stated" means the user said it. "inferred" means the companion is guessing. */
  basis: "stated" | "inferred";
  createdAt: number;
  updatedAt: number;
}

export interface ChatRequest {
  profile: Profile;
  /** Recent turns of this conversation, oldest first. */
  turns: Pick<Turn, "role" | "text" | "interrupted">[];
  memories: Pick<Memory, "category" | "text" | "basis" | "createdAt">[];
  lastSession?: { endedAt: number; turns: Pick<Turn, "role" | "text">[] };
  localTime: string;
  opening?: boolean;
}

export type ChatEvent =
  | { t: "read"; read: Read }
  | { t: "delta"; text: string }
  | { t: "crisis" }
  | { t: "done" }
  | { t: "error"; message: string };

export interface MemoryOps {
  add: Pick<Memory, "category" | "text" | "quote" | "basis">[];
  update: { id: string; text: string }[];
  remove: string[];
}
