import type { Conversation, Memory, Profile } from "@/lib/types";

/**
 * Everything personal stays on this device. The server is stateless: it sees
 * a turn's context only while answering it and stores nothing.
 */
const KEYS = { profile: "yaar.profile", memories: "yaar.memories", conversations: "yaar.conversations" };
const MAX_CONVERSATIONS = 40;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked. The conversation still works without it.
  }
}

export const store = {
  profile: () => read<Profile | null>(KEYS.profile, null),
  saveProfile: (profile: Profile) => write(KEYS.profile, profile),

  memories: () => read<Memory[]>(KEYS.memories, []),
  saveMemories: (memories: Memory[]) => write(KEYS.memories, memories),

  conversations: () => read<Conversation[]>(KEYS.conversations, []),
  saveConversation(conversation: Conversation) {
    if (!conversation.turns.length) return;
    const others = this.conversations().filter((c) => c.id !== conversation.id);
    write(KEYS.conversations, [conversation, ...others].slice(0, MAX_CONVERSATIONS));
  },
  deleteConversation(id: string) {
    write(KEYS.conversations, this.conversations().filter((c) => c.id !== id));
  },

  exportAll: () => ({
    exportedAt: new Date().toISOString(),
    profile: read(KEYS.profile, null),
    memories: read(KEYS.memories, []),
    conversations: read(KEYS.conversations, []),
  }),

  wipe() {
    try {
      for (const key of Object.values(KEYS)) localStorage.removeItem(key);
    } catch {}
  },
};
