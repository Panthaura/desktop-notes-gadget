import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnglish() {
  const candidates = [
    path.join(here, "..", "src", "i18n", "en.json"),
    path.join(here, "i18n", "en.json"),
    path.join(process.resourcesPath || "", "i18n", "en.json"),
  ];
  for (const file of candidates) {
    try {
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // ignore
    }
  }
  return {};
}

const en = loadEnglish();

let locale = "de";

export function setLocale(next) {
  locale = next === "en" ? "en" : "de";
}

export function getLocale() {
  return locale;
}

export function t(key, german, vars) {
  let text = locale === "en" && en[key] ? en[key] : german;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function dateLocale() {
  return locale === "en" ? "en-GB" : "de-DE";
}
