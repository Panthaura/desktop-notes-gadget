import type { ReactNode } from "react";
import { t, useT } from "./i18n";

const TOKEN_RE = /(https:\/\/[^\s<>"'\]\)]+|mailto:[^\s<>"']+|\+?\d{3,})/g;

function trimUrl(url: string) {
  return url.replace(/[.,;:!?)]+$/g, "");
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="2.5"
        y="2.5"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export default function RichText({
  text,
  onCopied,
}: {
  text: string;
  onCopied?: (message: string) => void;
}) {
  useT();
  if (!text) return null;

  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(text);

  while (match) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const raw = match[0];

    if (raw.startsWith("https://")) {
      const href = trimUrl(raw);
      const extra = raw.slice(href.length);
      nodes.push(
        <a
          key={`l-${key}`}
          href={href}
          className="rich-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void window.notesApi.openLink(href);
          }}
        >
          {href}
        </a>,
      );
      if (extra) nodes.push(extra);
    } else if (raw.startsWith("mailto:")) {
      const href = trimUrl(raw);
      const extra = raw.slice(href.length);
      const label = href.replace(/^mailto:/i, "");
      nodes.push(
        <a
          key={`m-${key}`}
          href={href}
          className="rich-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void window.notesApi.openLink(href);
          }}
        >
          {label}
        </a>,
      );
      if (extra) nodes.push(extra);
    } else {
      nodes.push(
        <span key={`n-${key}`} className="rich-number">
          {raw}
          <button
            type="button"
            className="copy-num"
            title={t("copyNumber", "Zahl kopieren")}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await window.notesApi.copyText(raw);
              onCopied?.(t("numberCopied", "Zahl kopiert"));
            }}
          >
            <CopyIcon />
          </button>
        </span>,
      );
    }

    key += 1;
    last = match.index + raw.length;
    match = TOKEN_RE.exec(text);
  }

  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
