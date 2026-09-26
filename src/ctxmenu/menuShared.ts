export const NOTE_COLOR_PALETTE = [
  "#f5d76e",
  "#f0a8a8",
  "#f4b86a",
  "#a8d8a8",
  "#9ec5e8",
  "#c9b1e8",
  "#f2c4de",
  "#b8e0d2",
  "#d4c4a8",
  "#e8e8e8",
];

export const NOTE_EMOJI_PICKER = [
  "😀",
  "😊",
  "😂",
  "😍",
  "🤔",
  "😎",
  "😢",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "🔥",
  "⭐",
  "💡",
  "✅",
  "❌",
  "⚠️",
  "📌",
  "📝",
  "📅",
  "⏰",
  "🔔",
  "💼",
  "🏠",
  "💻",
  "📞",
  "✉️",
  "🛒",
  "🎵",
  "🎮",
  "☕",
  "🍕",
  "❤️",
  "💚",
  "💙",
  "💜",
  "🖤",
  "🎉",
  "🚀",
  "🎯",
  "🔑",
  "📎",
  "🗂️",
  "🏆",
  "🌟",
  "💤",
  "🤝",
];

export function tomorrowAtNine() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export function toDatetimeLocalValue(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRemindShort(
  ms: number,
  translate: (key: string, german: string, vars?: Record<string, string | number>) => string,
  locale: string,
) {
  const diff = ms - Date.now();
  if (diff <= 0) return translate("remindDue", "fällig");
  const mins = Math.round(diff / 60000);
  if (mins < 60) return translate("remindInMin", "in {n} Min.", { n: Math.max(1, mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return translate("remindInHours", "in {n} Std.", { n: hours });
  return new Date(ms).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
