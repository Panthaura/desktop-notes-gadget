import { useEffect, useState } from "react";
import en from "./i18n/en.json";

export type Locale = "de" | "en";

type Vars = Record<string, string | number>;

const enTable = en as Record<string, string>;
const listeners = new Set<() => void>();

let locale: Locale = "de";

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
    text,
  );
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: string | undefined) {
  locale = next === "en" ? "en" : "de";
  for (const listener of listeners) listener();
}

export function onLocaleChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(key: string, german: string, vars?: Vars) {
  const text = locale === "en" && enTable[key] ? enTable[key] : german;
  return interpolate(text, vars);
}

export function dateLocale() {
  return locale === "en" ? "en-GB" : "de-DE";
}

export function useT() {
  const [, setTick] = useState(0);
  useEffect(() => onLocaleChange(() => setTick((n) => n + 1)), []);
  return t;
}
