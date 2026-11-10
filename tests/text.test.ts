import assert from "node:assert/strict";
import { test } from "node:test";
import { ReadSplitter, SentenceChunker, ThinkStripper, cleanForSpeech, detectCrisis, stripTags, ttsLanguage } from "../src/lib/text.ts";

function runSplitter(parts: string[]) {
  const splitter = new ReadSplitter();
  let text = "";
  let read;
  for (const part of parts) {
    const out = splitter.push(part);
    text += out.text;
    read = out.read ?? read;
  }
  return { text: text + splitter.flush(), read };
}

test("hidden read survives being split across tokens", () => {
  const { text, read } = runSplitter(['<re', 'ad>{"mood":"low","certa', 'inty":0.6,"wants":"heard"}</re', "ad>\nOuch.", " What happened?"]);
  assert.deepEqual(read, { mood: "low", certainty: 0.6, wants: "heard" });
  assert.equal(text, "Ouch. What happened?");
});

test("reply that starts with an audio tag is not mistaken for a read", () => {
  const { text, read } = runSplitter(["<si", "gh> Ek kaam karo."]);
  assert.equal(read, undefined);
  assert.equal(text, "<sigh> Ek kaam karo.");
});

test("malformed read does not leak into speech", () => {
  const { text, read } = runSplitter(["<read>{oops</read>Haan bolo."]);
  assert.equal(read, undefined);
  assert.equal(text, "Haan bolo.");
});

test("chunker waits for real sentence ends and merges tiny fragments", () => {
  const chunker = new SentenceChunker();
  const out = [...chunker.push("Ouch. It's not about going out, is it? "), ...chunker.push("It's that they")];
  assert.deepEqual(out, ["Ouch. It's not about going out, is it?"]);
  assert.equal(chunker.flush(), "It's that they");
});

test("chunker splits on the Devanagari danda", () => {
  const chunker = new SentenceChunker();
  assert.deepEqual(chunker.push("आज का दिन बहुत भारी था। फिर क्या"), ["आज का दिन बहुत भारी था।"]);
});

test("decimals do not end a sentence", () => {
  const chunker = new SentenceChunker();
  assert.deepEqual(chunker.push("Maine 3.5 ghante wait kiya"), []);
});

test("audio tags are hidden from text but kept for speech", () => {
  assert.equal(stripTags("<sigh> Yaar, sach mein?"), "Yaar, sach mein?");
  assert.equal(cleanForSpeech("<sigh> **Yaar**, <dance> sach mein?"), "<sigh> Yaar, sach mein?");
  assert.equal(cleanForSpeech("<sigh>"), "");
});

test("speech language follows script", () => {
  assert.equal(ttsLanguage("आज thoda heavy था", "auto"), "hi-en");
  assert.equal(ttsLanguage("आज का दिन भारी था", "auto"), "hi-IN");
  assert.equal(ttsLanguage("aaj kya hua yaar", "auto"), "hi-en");
  assert.equal(ttsLanguage("what happened today", "auto"), "en-IN");
  assert.equal(ttsLanguage("இன்று என்ன நடந்தது", "auto"), "auto");
  assert.equal(ttsLanguage("काय झालं", "mr-IN"), "mr-IN");
});

test("crisis net catches English, Hinglish and Hindi", () => {
  for (const line of [
    "I want to kill myself",
    "i just wanna die",
    "there is no reason to live",
    "ab jeena nahi chahta",
    "marna chahti hoon",
    "मैं मरना चाहता हूँ",
    "अब जीना नहीं चाहती",
    "आत्महत्या के बारे में सोच रहा हूँ",
  ]) {
    assert.equal(detectCrisis(line), true, line);
  }
});

test("crisis net ignores everyday exaggeration", () => {
  for (const line of ["this traffic is killing me", "I died laughing", "exam ne maar diya yaar", "dying to see that movie"]) {
    assert.equal(detectCrisis(line), false, line);
  }
});

test("reasoning in <think> blocks is never voiced", () => {
  const stripper = new ThinkStripper();
  const parts = ["<thi", "nk>user seems sad, be gentle</th", "ink>\n<read>{}</read>Arre", " yaar <sigh>", " kya hua?"];
  assert.equal(parts.map((part) => stripper.push(part)).join(""), "\n<read>{}</read>Arre yaar <sigh> kya hua?");
});
