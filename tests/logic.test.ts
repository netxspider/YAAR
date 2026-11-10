import assert from "node:assert/strict";
import { test } from "node:test";
import { Vad } from "../src/lib/vad.ts";
import { applyOps, retrieve } from "../src/lib/memory.ts";
import { defaultVoice, suggestNames } from "../src/lib/persona.ts";
import type { Memory } from "../src/lib/types.ts";

function feed(vad: Vad, rms: number, ms: number, guarded = false) {
  const events = [];
  for (let t = 0; t < ms; t += 20) {
    const event = vad.step(rms, 20, guarded);
    if (event) events.push(event);
  }
  return events;
}

test("vad starts on speech and ends after a pause", () => {
  const vad = new Vad();
  assert.deepEqual(feed(vad, 0.003, 1000), []);
  assert.deepEqual(feed(vad, 0.08, 600), ["start"]);
  assert.deepEqual(feed(vad, 0.004, 500), []);
  assert.deepEqual(feed(vad, 0.004, 600), ["end"]);
});

test("vad ignores a short click", () => {
  const vad = new Vad();
  feed(vad, 0.003, 500);
  assert.deepEqual(feed(vad, 0.2, 60), []);
  assert.deepEqual(feed(vad, 0.003, 500), []);
});

test("guarded vad ignores speaker echo but hears a real interruption", () => {
  const vad = new Vad();
  feed(vad, 0.003, 500);
  assert.deepEqual(feed(vad, 0.02, 1000, true), []);
  assert.deepEqual(feed(vad, 0.12, 500, true), ["start"]);
});

test("guarded vad catches real, uneven speech", () => {
  const vad = new Vad();
  feed(vad, 0.003, 500);
  // Syllables: loud, loud, quiet, repeated, at levels measured from Timbre speech.
  const events = [];
  for (let i = 0; i < 30; i++) {
    const event = vad.step([0.07, 0.04, 0.008][i % 3], 43, true);
    if (event) events.push(event);
  }
  assert.deepEqual(events, ["start"]);
});

const memory = (id: string, category: Memory["category"], text: string, daysAgo = 0): Memory => ({
  id,
  category,
  text,
  basis: "stated",
  createdAt: Date.now() - daysAgo * 86_400_000,
  updatedAt: Date.now() - daysAgo * 86_400_000,
});

test("retrieval favors relevant and preference memories", () => {
  const memories = [
    memory("1", "life", "Has a cricket match on Sunday", 30),
    memory("2", "people", "Best friend is Rahul, they fought last week", 30),
    memory("3", "preference", "Prefers being listened to over advice", 30),
    memory("4", "life", "Started learning guitar", 30),
  ];
  const top = retrieve(memories, "Rahul ne phir se ignore kiya", 2).map((m) => m.id);
  assert.deepEqual(top.sort(), ["2", "3"]);
});

test("memory ops update, remove, and skip duplicates", () => {
  let n = 0;
  const result = applyOps(
    [memory("a", "about", "Lives in Pune"), memory("b", "life", "Interviewing at Infosys")],
    {
      add: [
        { category: "about", text: "Lives in Pune", basis: "stated" },
        { category: "people", text: "Sister is called Priya", basis: "stated" },
      ],
      update: [{ id: "a", text: "Moved from Pune to Bengaluru" }],
      remove: ["b"],
    },
    Date.now(),
    () => `new${n++}`,
  );
  assert.deepEqual(
    result.map((m) => m.text),
    ["Moved from Pune to Bengaluru", "Lives in Pune", "Sister is called Priya"],
  );
});

test("names and voices fit the chosen persona", () => {
  assert.equal(suggestNames("female", 3).length, 3);
  assert.equal(defaultVoice("male", 24), "Devansh");
  assert.equal(defaultVoice("female", 60), "Chetana");
});
