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

/** e.g. "Mo, 28.09.26" / "Mo, 28.09.26" (EN weekday). */
export function formatHeaderDate(date = new Date()) {
  const weekdays = locale === "en"
    ? ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
    : ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = pad(date.getFullYear() % 100);
  return `${weekdays[date.getDay()]}, ${day}.${month}.${year}`;
}

export function useT() {
  const [, setTick] = useState(0);
  useEffect(() => onLocaleChange(() => setTick((n) => n + 1)), []);
  return t;
}
