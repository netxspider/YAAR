import type { Gender, LanguagePref } from "./types.ts";

const FEMALE = ["Aanya", "Meera", "Ishita", "Tara", "Kavya", "Naina", "Anika", "Riya", "Sanvi", "Mahi", "Zoya", "Pihu"];
const MALE = ["Aarav", "Kabir", "Vihaan", "Arjun", "Rohan", "Ishaan", "Dev", "Advait", "Neel", "Ayaan", "Veer", "Reyansh"];
const NEUTRAL = ["Kiran", "Noor", "Suman", "Jyoti", "Manu", "Anshu", "Shashi", "Ashu"];

export function suggestNames(gender: Gender, count = 5, random: () => number = Math.random): string[] {
  const pool = gender === "female" ? FEMALE : gender === "male" ? MALE : NEUTRAL;
  return [...pool].sort(() => random() - 0.5).slice(0, count);
}

export interface Voice {
  id: string;
  gender: "female" | "male";
  note: string;
}

/** Timbre v3.0 voices with warm or conversational personas, per Gnani's catalog. */
export const VOICES: Voice[] = [
  { id: "Lakshmi", gender: "female", note: "Expressive, warm" },
  { id: "Shivani", gender: "female", note: "Warm, patient" },
  { id: "Chetana", gender: "female", note: "Gentle, soft" },
  { id: "Kalpana", gender: "female", note: "Calm, composed" },
  { id: "Riyaa", gender: "female", note: "Lively, confident" },
  { id: "Devansh", gender: "male", note: "Young, chatty" },
  { id: "Yashraj", gender: "male", note: "Warm, grounded" },
  { id: "Shubham", gender: "male", note: "Energetic" },
  { id: "Prakash", gender: "male", note: "Steady, unhurried" },
];

export const isVoice = (id: string) => VOICES.some((voice) => voice.id === id);

/** Picks a starting voice from gender and age. It can be changed in settings. */
export function defaultVoice(gender: Gender, age: number): string {
  if (gender === "male") return age < 30 ? "Devansh" : age < 50 ? "Yashraj" : "Prakash";
  return age < 30 ? "Lakshmi" : age < 50 ? "Shivani" : "Chetana";
}

export const LANGUAGES: { value: LanguagePref; label: string }[] = [
  { value: "auto", label: "Whatever I speak" },
  { value: "hi-IN", label: "Hindi + English" },
  { value: "en-IN", label: "English" },
  { value: "mr-IN", label: "मराठी" },
  { value: "bn-IN", label: "বাংলা" },
  { value: "gu-IN", label: "ગુજરાતી" },
  { value: "pa-IN", label: "ਪੰਜਾਬੀ" },
  { value: "ta-IN", label: "தமிழ்" },
  { value: "te-IN", label: "తెలుగు" },
  { value: "kn-IN", label: "ಕನ್ನಡ" },
  { value: "ml-IN", label: "മലയാളം" },
];

export const MIN_AGE = 18;
export const MAX_AGE = 75;
