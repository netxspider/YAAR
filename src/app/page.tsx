"use client";

import { useEffect, useState } from "react";
import { store } from "@/client/store";
import { Onboarding } from "@/components/Onboarding";
import { Talk } from "@/components/Talk";
import type { Profile } from "@/lib/types";

export default function Home() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => setProfile(store.profile()), []);

  if (profile === undefined) return <main className="talk" />;

  if (!profile) {
    return (
      <main className="welcome">
        <header className="topbar">
          <span className="wordmark">YAAR</span>
        </header>
        <div className="welcome-intro">
          <p className="tagline">
            A friend to talk to, <em>in your own words.</em>
          </p>
        </div>
        <Onboarding
          onDone={(next) => {
            store.saveProfile(next);
            setProfile(next);
          }}
        />
      </main>
    );
  }

  return <Talk key={profile.createdAt} profile={profile} onReset={() => setProfile(null)} />;
}
