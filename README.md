# YAAR

A voice-first AI friend for India. Open it, tap the ball, and just talk: in Hindi, English, Hinglish, or any of ten Indian languages. YAAR listens, gets what you mean (not just what you said), and talks back in a natural voice, with a particle ball that moves with every word.

Built for **The Great Indian AI Internship Challenge** on Gnani's models.

## What it does

- **Talk without a button.** The mic stays open. YAAR detects when you start and stop speaking, and you can talk over it mid-sentence: it stops, keeps only what you actually heard, and follows you.
- **Natural, not chatbot-y.** Short replies, no "I completely understand", no question after every line. It listens when you vent, jokes when you joke, disagrees when you're being unfair to yourself.
- **Hinglish by default.** Replies mirror how you talk: Devanagari for Hindi, Latin for English words, exactly as Prisma's `codemix` transcribes them.
- **Expressive voice.** The model can drop a `<sigh>` or `<laugh>` into its reply, and Timbre v3.0 performs it.
- **A companion you design.** Name (or pick a suggested Indian name), gender and age. The voice is matched to them and can be changed.
- **Memory you control.** It remembers people, plans and preferences, marks guesses as guesses, and lets you read, edit or delete every memory. You opt in at setup.
- **Safe by design.** No guilt-tripping, no "I'm the only one who gets you", no romance. Distress language triggers a gentle check-in and Tele-MANAS (14416) / 112 numbers.

## How Gnani's models are used

| Model | Where | How |
|---|---|---|
| **Prisma v3.0** (speech-to-text) | `src/server/gnani.ts` → `transcribe` | Every utterance, `format=codemix`, `indic-auto` detection that becomes sticky after the first long sentence, `keyterms` for the companion's and user's names, `previous_text` to stitch long (>28s) venting across segments |
| **Timbre v3.0** (text-to-speech) | `src/server/gnani.ts` → `synthesizeStream` | SSE streaming, sentence by sentence, raw 24 kHz PCM played gaplessly with Web Audio. Inline audio tags for emotion, voice/pace/language per user |
| **Evon v3.3** (LLM, the brain) | `src/server/llm.ts` | Preferred reasoning model. Streams the reply plus a hidden mood read; any `<think>` reasoning is stripped before it can be voiced |

Why REST for Prisma instead of the realtime socket: the socket authenticates with handshake headers that browsers cannot send, and it only emits final segments anyway. YAAR runs voice detection in the browser and sends complete utterances to the REST endpoint (≈0.15 s processing), so it deploys on serverless with no socket proxy and nothing is lost.

**Evon as the brain.** Evon v3.3 is released as open weights (`gnani/gnani-evon-v3.3-30B-A3B`, Apache 2.0), not on Gnani's API gateway, so it runs on your own GPU or a Hugging Face Inference Endpoint:

```bash
vllm serve gnani/gnani-evon-v3.3-30B-A3B --port 8000
# then in .env.local
EVON_BASE_URL=http://localhost:8000/v1
```

`src/server/llm.ts` uses Evon whenever `EVON_BASE_URL` is set. Without it, YAAR falls back to Claude (`ANTHROPIC_API_KEY`) or any OpenAI-compatible server (`LLM_BASE_URL` + `LLM_MODEL`), so the app runs on a laptop with no GPU.

## Run it

```bash
cp .env.example .env.local   # add GNANI_API_KEY and a model key
npm install
npm run dev                  # http://localhost:3000
npm test                     # 18 unit tests: VAD, streaming parser, crisis net, memory
```

Use Chrome or Edge, and headphones if your laptop's echo cancellation is weak.

## Architecture

```
Browser                                       Next.js server (stateless)
───────                                       ──────────────────────────
mic → AudioWorklet → VAD ── utterance.wav ──► /api/stt ──► Gnani Prisma v3.0
                                                    ◄── transcript
session ─ turns + retrieved memories ───────► /api/chat ─► LLM (stream)
        ◄── ndjson: hidden read, text deltas ──┘   splits <read>{mood,wants}</read>
sentence chunker ── one sentence at a time ─► /api/tts ──► Gnani Timbre v3.0 (SSE)
Web Audio queue ◄── raw PCM stream ────────────┘
   └─ analyser → particle ball (WebGL2)
session ─ last turns + memory ids ──────────► /api/memory ► LLM → add/update/remove
localStorage: profile, memories, conversations
```

- **Emotional read.** Each reply starts with a hidden `<read>{"mood","certainty","wants"}</read>`. The server strips it; the client uses it only to tint the ball, and only when the model is reasonably sure. The user never sees a label.
- **Turn-taking.** The VAD learns the room's noise floor and becomes stricter while YAAR talks, so its own echo doesn't cut it off. If you keep talking before the reply starts, the half-formed reply is dropped and your words are merged.
- **Memory.** Every two user turns, a separate call proposes at most three changes. Retrieval picks preferences plus whatever overlaps with the current topic.

## Privacy

There are no accounts and no database. Profile, memories and chats live in the browser's `localStorage` and can be exported or wiped from the Privacy tab. Audio and text go over HTTPS to Gnani and the model provider for each turn, and YAAR's server keeps nothing. API keys stay server-side; the API routes reject cross-site calls and rate-limit by IP. Stored data is not encrypted at rest beyond what the browser provides, which is stated in the app.

## Project map

```
src/server/gnani.ts      Prisma + Timbre adapters
src/server/llm.ts        reasoning-model adapter (Gnani Evon / Claude / OpenAI-compatible)
src/server/prompt.ts     companion personality, context building, memory extraction prompt
src/client/session.ts    conversation engine: listening, barge-in, replies, memory
src/client/speaker.ts    streaming, interruptible playback
src/lib/vad.ts           voice activity detection
src/lib/text.ts          stream parsing, sentence chunking, language choice, crisis net
src/components/          particle ball, onboarding, conversation, settings sheet
```
