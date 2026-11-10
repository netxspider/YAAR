"use client";

import { useEffect, useState } from "react";
import type { Session } from "@/client/session";
import { store } from "@/client/store";
import { LANGUAGES, MAX_AGE, MIN_AGE, VOICES } from "@/lib/persona";
import type { Conversation, Gender, LanguagePref, Memory, MemoryCategory, Profile, Turn } from "@/lib/types";
import { CloseIcon, PlayIcon, TrashIcon } from "./Icons";

type Tab = "memory" | "chats" | "companion" | "privacy";
const TABS: { id: Tab; label: string }[] = [
  { id: "memory", label: "Memory" },
  { id: "chats", label: "Chats" },
  { id: "companion", label: "Companion" },
  { id: "privacy", label: "Privacy" },
];

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  about: "About you",
  people: "People",
  life: "What's going on",
  preference: "How you like to talk",
};

function MemoryTab({ session, profile, setProfile }: { session: Session; profile: Profile; setProfile: (p: Profile) => void }) {
  const [memories, setMemories] = useState<Memory[]>(() => store.memories());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const save = (next: Memory[]) => {
    setMemories(next);
    session.setMemories(next);
  };

  return (
    <div className="tab-body">
      <label className="toggle">
        <input type="checkbox" checked={profile.memoryEnabled} onChange={(event) => setProfile({ ...profile, memoryEnabled: event.target.checked })} />
        <span>
          Remember things I share
          <small>When off, nothing new is saved and nothing stored is used.</small>
        </span>
      </label>

      {memories.length === 0 && (
        <p className="empty">Nothing yet. As you talk, {profile.companion.name} keeps a few notes here. You can say &ldquo;don&apos;t remember that&rdquo; anytime.</p>
      )}

      {(Object.keys(CATEGORY_LABEL) as MemoryCategory[]).map((category) => {
        const items = memories.filter((memory) => memory.category === category);
        if (!items.length) return null;
        return (
          <section key={category} className="memory-group">
            <h3>{CATEGORY_LABEL[category]}</h3>
            <ul>
              {items.map((memory) => (
                <li key={memory.id}>
                  {editing === memory.id ? (
                    <form
                      className="inline-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        save(memories.map((m) => (m.id === memory.id ? { ...m, text: draft.trim() || m.text, basis: "stated", updatedAt: Date.now() } : m)));
                        setEditing(null);
                      }}
                    >
                      <input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus aria-label="Edit memory" />
                      <button className="small" type="submit">Save</button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="memory-text"
                        onClick={() => {
                          setEditing(memory.id);
                          setDraft(memory.text);
                        }}
                        title="Edit"
                      >
                        {memory.text}
                        {memory.basis === "inferred" && <span className="badge">guess</span>}
                        <time>{new Date(memory.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</time>
                      </button>
                      <button className="icon-button small" aria-label="Forget this" onClick={() => save(memories.filter((m) => m.id !== memory.id))}>
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ChatsTab({ turns }: { turns: Turn[] }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setConversations(store.conversations()), [turns]);

  if (!conversations.length) return <p className="empty tab-body">Your conversations will show up here.</p>;

  return (
    <ul className="tab-body chats">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <div className="chat-row">
            <button className="chat-head" onClick={() => setOpen(open === conversation.id ? null : conversation.id)} aria-expanded={open === conversation.id}>
              <time>{new Date(conversation.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time>
              <span>{conversation.turns.find((t) => t.role === "user")?.text ?? conversation.turns[0]?.text}</span>
            </button>
            <button
              className="icon-button small"
              aria-label="Delete conversation"
              onClick={() => {
                store.deleteConversation(conversation.id);
                setConversations(store.conversations());
              }}
            >
              <TrashIcon />
            </button>
          </div>
          {open === conversation.id && (
            <ol className="transcript">
              {conversation.turns.map((turn) => (
                <li key={turn.id} className={turn.role}>
                  {turn.text}
                  {turn.interrupted && <span className="badge">cut off</span>}
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

function CompanionTab({ session, profile, setProfile }: { session: Session; profile: Profile; setProfile: (p: Profile) => void }) {
  const companion = profile.companion;
  const setCompanion = (patch: Partial<Profile["companion"]>) => setProfile({ ...profile, companion: { ...companion, ...patch } });

  return (
    <div className="tab-body form">
      <label className="field">
        <span>Name</span>
        <input value={companion.name} onChange={(event) => setCompanion({ name: event.target.value.slice(0, 24) || companion.name })} />
      </label>
      <label className="field">
        <span>Gender</span>
        <select value={companion.gender} onChange={(event) => setCompanion({ gender: event.target.value as Gender })}>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="neutral">Non-binary</option>
        </select>
      </label>
      <label className="field">
        <span>
          Age <output className="age">{companion.age}</output>
        </span>
        <input type="range" min={MIN_AGE} max={MAX_AGE} value={companion.age} onChange={(event) => setCompanion({ age: Number(event.target.value) })} />
      </label>

      <div className="field">
        <span>Voice (Gnani Timbre v3.0)</span>
        <ul className="voices">
          {VOICES.map((voice) => (
            <li key={voice.id} className={voice.id === companion.voice ? "on" : ""}>
              <button className="voice-pick" onClick={() => setCompanion({ voice: voice.id })} aria-pressed={voice.id === companion.voice}>
                <strong>{voice.id}</strong>
                <small>{voice.note}</small>
              </button>
              <button className="icon-button small" aria-label={`Hear ${voice.id}`} onClick={() => session.preview(voice.id)}>
                <PlayIcon />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <label className="field">
        <span>Language</span>
        <select value={profile.language} onChange={(event) => setProfile({ ...profile, language: event.target.value as LanguagePref })}>
          {LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>
          Speaking pace <output className="age">{profile.speed.toFixed(2)}×</output>
        </span>
        <input type="range" min={0.85} max={1.15} step={0.05} value={profile.speed} onChange={(event) => setProfile({ ...profile, speed: Number(event.target.value) })} />
      </label>
    </div>
  );
}

function PrivacyTab({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);

  const download = () => {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "yaar-data.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tab-body prose">
      <h3>Where your words go</h3>
      <ul>
        <li>Your profile, memories and chats are stored only in this browser. There are no accounts and no server database.</li>
        <li>For each turn, your voice goes to Gnani (Prisma for speech-to-text, Timbre for the voice reply), and the text of the conversation goes to the reasoning model, over HTTPS. YAAR&apos;s server keeps none of it.</li>
        <li>Anyone with access to this browser profile can open YAAR and read what&apos;s stored. Delete it below if that matters.</li>
        <li>{`YAAR is an AI friend, not a therapist. If you're in danger, call 112, or Tele-MANAS at 14416 any time.`}</li>
      </ul>
      <div className="row">
        <button className="secondary" onClick={download}>
          Export my data
        </button>
        {confirming ? (
          <button
            className="danger"
            onClick={() => {
              store.wipe();
              onReset();
            }}
          >
            Yes, delete everything
          </button>
        ) : (
          <button className="danger ghost" onClick={() => setConfirming(true)}>
            Delete everything
          </button>
        )}
      </div>
      {confirming && <p className="fine">This removes your companion, memories and every chat from this device. It can&apos;t be undone.</p>}
    </div>
  );
}

export function Sheet({ session, turns, onClose, onReset }: { session: Session; turns: Turn[]; onClose: () => void; onReset: () => void }) {
  const [tab, setTab] = useState<Tab>("memory");
  const [profile, setProfileState] = useState(session.profile);
  const setProfile = (next: Profile) => {
    setProfileState(next);
    session.updateProfile(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Memories, history and settings" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <nav className="tabs" role="tablist">
            {TABS.map((item) => (
              <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "on" : ""} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {tab === "memory" && <MemoryTab session={session} profile={profile} setProfile={setProfile} />}
        {tab === "chats" && <ChatsTab turns={turns} />}
        {tab === "companion" && <CompanionTab session={session} profile={profile} setProfile={setProfile} />}
        {tab === "privacy" && <PrivacyTab onReset={onReset} />}
      </div>
    </div>
  );
}
