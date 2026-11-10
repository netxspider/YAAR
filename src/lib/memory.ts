import type { Memory, MemoryOps } from "./types.ts";

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
}

/**
 * Picks the memories worth putting in front of the model for this turn:
 * preferences always, then whatever overlaps with what's being said, then the
 * most recent, so long histories don't crowd out the prompt.
 */
export function retrieve(memories: Memory[], query: string, limit = 14, now = Date.now()): Memory[] {
  const queryWords = words(query);
  const scored = memories.map((memory) => {
    let overlap = 0;
    for (const word of words(memory.text)) if (queryWords.has(word)) overlap += 1;
    const ageDays = (now - memory.updatedAt) / 86_400_000;
    const score =
      (memory.category === "preference" ? 3 : 0) +
      (memory.category === "about" ? 1.5 : 0) +
      overlap * 2 +
      Math.max(0, 1.5 - ageDays / 14);
    return { memory, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.memory);
}

export function applyOps(memories: Memory[], ops: MemoryOps, now = Date.now(), id = () => crypto.randomUUID()): Memory[] {
  const removed = new Set(ops.remove);
  const updates = new Map(ops.update.map((update) => [update.id, update.text]));
  const kept = memories
    .filter((memory) => !removed.has(memory.id))
    .map((memory) => (updates.has(memory.id) ? { ...memory, text: updates.get(memory.id)!, updatedAt: now } : memory));

  const seen = new Set(kept.map((memory) => memory.text.toLowerCase()));
  for (const item of ops.add) {
    if (seen.has(item.text.toLowerCase())) continue;
    kept.push({ ...item, id: id(), createdAt: now, updatedAt: now });
  }
  return kept;
}
