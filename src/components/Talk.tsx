"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Session } from "@/client/session";
import type { Profile } from "@/lib/types";
import { CloseIcon, KeyboardIcon, MenuIcon, MicIcon, MicOffIcon, SendIcon, StopIcon } from "./Icons";
import { ParticleBall, type BallSignal } from "./ParticleBall";
import { Sheet } from "./Sheet";

const STATUS = {
  off: "",
  listening: "listening",
  hearing: "hearing you",
  thinking: "thinking",
  speaking: "tap the ball to cut in",
} as const;

export function Talk({ profile, onReset }: { profile: Profile; onReset: () => void }) {
  const [session] = useState(() => new Session(profile));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [brainReady, setBrainReady] = useState(true);
  const signal = useRef<BallSignal | null>(null);
  const input = useRef<HTMLInputElement>(null);

  signal.current = { phase: state.phase, mood: state.mood, levels: () => session.levels() };

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((status) => setBrainReady(Boolean(status.brain)))
      .catch(() => {});
    const save = () => session.persist();
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      session.stop();
    };
  }, [session]);

  useEffect(() => {
    document.documentElement.dataset.mood = state.mood;
  }, [state.mood]);

  useEffect(() => {
    if (typing) input.current?.focus();
  }, [typing]);

  const started = state.phase !== "off";
  const name = session.profile.companion.name;

  const onBall = () => {
    if (!started) void session.start();
    else if (state.phase === "speaking" || state.phase === "thinking") session.interrupt();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    if (!started) void session.start().then(() => session.sendText(draft));
    else session.sendText(draft);
    setDraft("");
  };

  return (
    <main className={`talk phase-${state.phase}`}>
      <header className="topbar">
        <span className="wordmark">YAAR</span>
        <span className="who">
          {name}
          {started && <span className="status">{STATUS[state.phase]}</span>}
        </span>
        <button className="icon-button" aria-label="Memories, history and settings" onClick={() => setSheetOpen(true)}>
          <MenuIcon />
        </button>
      </header>

      <button
        className="ball-stage"
        onClick={onBall}
        aria-label={!started ? `Start talking with ${name}` : state.phase === "speaking" ? `Interrupt ${name}` : `${name} is ${STATUS[state.phase]}`}
      >
        <ParticleBall signal={signal} className="ball" />
        {!started && (
          <span className="start-hint">
            <span>Tap to talk with {name}</span>
            <small>Just speak. Hindi, English, or both.</small>
          </span>
        )}
      </button>

      <section className="captions" aria-live="polite">
        {state.heard && <p className="heard">{state.heard}</p>}
        {state.saying && <p className={`saying ${state.phase === "speaking" ? "live" : ""}`}>{state.saying}</p>}
        {!brainReady && (
          <p className="notice">Speech is connected, but no reasoning model is configured. Add a key to .env.local (see README).</p>
        )}
      </section>

      {state.crisis && (
        <aside className="crisis" role="alert">
          <div>
            <strong>You don&apos;t have to carry this alone.</strong>
            <span>
              Tele-MANAS, free and 24×7: <a href="tel:14416">14416</a>. Emergency: <a href="tel:112">112</a>.
            </span>
          </div>
          <button className="icon-button" aria-label="Dismiss" onClick={session.dismissCrisis}>
            <CloseIcon />
          </button>
        </aside>
      )}

      {state.notice && (
        <button className="toast" onClick={session.dismissNotice}>
          {state.notice}
        </button>
      )}

      <footer className="dock">
        {typing ? (
          <form className="composer" onSubmit={submit}>
            <input ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${name}`} aria-label={`Message ${name}`} enterKeyHint="send" />
            <button className="icon-button send" type="submit" aria-label="Send" disabled={!draft.trim()}>
              <SendIcon />
            </button>
            <button className="icon-button" type="button" aria-label="Back to voice" onClick={() => setTyping(false)}>
              <MicIcon />
            </button>
          </form>
        ) : (
          <>
            <button className="icon-button" aria-label="Type instead" onClick={() => setTyping(true)}>
              <KeyboardIcon />
            </button>
            <button
              className={`mic ${state.micOn ? "on" : "off"}`}
              aria-pressed={state.micOn}
              aria-label={state.micOn ? "Mute microphone" : "Unmute microphone"}
              disabled={!state.micAvailable || !started}
              onClick={() => session.setMic(!state.micOn)}
            >
              {state.micOn ? <MicIcon /> : <MicOffIcon />}
            </button>
            <button
              className="icon-button"
              aria-label={`Stop ${name}`}
              disabled={state.phase !== "speaking" && state.phase !== "thinking"}
              onClick={() => session.interrupt()}
            >
              <StopIcon />
            </button>
          </>
        )}
      </footer>

      {sheetOpen && <Sheet session={session} turns={state.turns} onClose={() => setSheetOpen(false)} onReset={onReset} />}
    </main>
  );
}
