"use client";

import { useEffect, useState } from "react";
import { MAX_AGE, MIN_AGE, defaultVoice, suggestNames } from "@/lib/persona";
import type { Gender, Profile } from "@/lib/types";
import { ShuffleIcon } from "./Icons";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "neutral", label: "Non-binary" },
];

function Segmented({ value, onChange, label }: { value: Gender; onChange: (g: Gender) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {GENDERS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: (profile: Profile) => void }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [gender, setGender] = useState<Gender>("female");
  const [name, setName] = useState("");
  const [age, setAge] = useState(24);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [userName, setUserName] = useState("");
  const [userGender, setUserGender] = useState<Gender>("neutral");

  useEffect(() => setSuggestions(suggestNames(gender)), [gender]);

  const companionName = name.trim() || suggestions[0] || "Aanya";

  const finish = (memoryEnabled: boolean) =>
    onDone({
      companion: { name: companionName, gender, age, voice: defaultVoice(gender, age) },
      user: { name: userName.trim(), gender: userGender },
      memoryEnabled,
      language: "auto",
      speed: 1,
      createdAt: Date.now(),
    });

  return (
    <section className="onboarding" aria-live="polite">
      {step === 0 ? (
        <form
          className="card-step"
          onSubmit={(event) => {
            event.preventDefault();
            setStep(1);
          }}
        >
          <p className="eyebrow">Step 1 of 2</p>
          <h1>Who would you like to talk to?</h1>

          <label className="field">
            <span>Their name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 24))}
              placeholder={suggestions[0] ?? "Aanya"}
              autoComplete="off"
              aria-describedby="name-hint"
            />
          </label>
          <div className="chips" id="name-hint">
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                className={`chip ${companionName === suggestion ? "on" : ""}`}
                onClick={() => setName(suggestion)}
              >
                {suggestion}
              </button>
            ))}
            <button type="button" className="chip ghost" aria-label="More names" onClick={() => setSuggestions(suggestNames(gender))}>
              <ShuffleIcon />
            </button>
          </div>

          <div className="field">
            <span>Gender</span>
            <Segmented value={gender} onChange={setGender} label="Companion gender" />
          </div>

          <label className="field">
            <span>
              Age <output className="age">{age}</output>
            </span>
            <input type="range" min={MIN_AGE} max={MAX_AGE} value={age} onChange={(event) => setAge(Number(event.target.value))} />
          </label>

          <button className="primary" type="submit">
            Continue with {companionName}
          </button>
        </form>
      ) : (
        <div className="card-step">
          <p className="eyebrow">Step 2 of 2</p>
          <h1>And you?</h1>

          <label className="field">
            <span>What should {companionName} call you? (optional)</span>
            <input value={userName} onChange={(event) => setUserName(event.target.value.slice(0, 32))} placeholder="Your name or nickname" autoComplete="given-name" />
          </label>

          <div className="field">
            <span>In Hindi, talk to me as</span>
            <Segmented value={userGender} onChange={setUserGender} label="How to address you" />
          </div>

          <div className="consent">
            <p>
              <strong>Should {companionName} remember things you share?</strong> Names, plans, what&apos;s going on. It stays on
              this device, and you can see, edit or delete every memory.
            </p>
            <div className="consent-actions">
              <button className="primary" type="button" onClick={() => finish(true)}>
                Yes, remember me
              </button>
              <button className="secondary" type="button" onClick={() => finish(false)}>
                Only this conversation
              </button>
            </div>
          </div>
          <button className="link" type="button" onClick={() => setStep(0)}>
            Back
          </button>
        </div>
      )}
    </section>
  );
}
