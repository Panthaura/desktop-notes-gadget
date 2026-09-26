export const DEFAULT_COLOR_BG = "#14110c";
export const DEFAULT_COLOR_ACCENT = "#f0c94d";
export const DEFAULT_COLOR_BLINK = "#e23d3d";

function clampByte(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function normalizeHex(value: string | undefined, fallback: string) {
  const raw = String(value || "").trim();
  const short = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = raw.match(/^#([0-9a-fA-F]{6})$/);
  return full ? `#${full[1].toLowerCase()}` : fallback;
}

function rgb(hex: string) {
  const h = normalizeHex(hex, "#000000").slice(1);
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => clampByte(n).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: string, b: string, amount: number) {
  const from = rgb(a);
  const to = rgb(b);
  return toHex(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
  );
}

function luma(hex: string) {
  const { r, g, b } = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildPalette(bgRaw?: string, accentRaw?: string) {
  const bg = normalizeHex(bgRaw, DEFAULT_COLOR_BG);
  const accent = normalizeHex(accentRaw, DEFAULT_COLOR_ACCENT);
  const dark = luma(bg) < 0.45;
  const paper = mix(accent, "#ffffff", 0.16);
  const paperHot = mix(accent, "#ffffff", 0.3);
  const onPaper = luma(paper) > 0.55 ? mix(bg, "#000000", 0.42) : mix("#ffffff", accent, 0.1);
  return {
    "--bg": bg,
    "--bg-elevated": mix(bg, dark ? "#ffffff" : "#000000", dark ? 0.08 : 0.06),
    "--bg-header": mix(bg, dark ? "#000000" : "#ffffff", dark ? 0.16 : 0.08),
    "--bg-button": mix(bg, accent, dark ? 0.14 : 0.2),
    "--bg-button-hover": mix(bg, accent, dark ? 0.24 : 0.32),
    "--yellow": accent,
    "--yellow-hot": mix(accent, "#ffffff", 0.22),
    "--yellow-dim": mix(accent, bg, 0.36),
    "--ink": luma(accent) > 0.42 ? mix(bg, "#000000", 0.32) : mix("#ffffff", accent, 0.08),
    "--text": dark ? mix("#f6ecd4", accent, 0.1) : mix("#1b160c", accent, 0.08),
    "--muted": dark ? mix("#b7a57c", accent, 0.28) : mix("#6d5c2a", accent, 0.18),
    "--card": paper,
    "--card-hover": paperHot,
    "--card-text": onPaper,
    "--card-muted": mix(onPaper, paper, 0.42),
    "--line": rgba(accent, 0.18),
    "--accent-soft": rgba(accent, 0.12),
    "--accent-glow": rgba(accent, 0.55),
    "--card-fold": mix(accent, bg, 0.22),
  };
}

export function applyPalette(bg?: string, accent?: string, blink?: string) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(buildPalette(bg, accent))) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty("--blink-color", normalizeHex(blink, DEFAULT_COLOR_BLINK));
}
