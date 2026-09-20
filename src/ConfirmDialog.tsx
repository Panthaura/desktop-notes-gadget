import { useRef, useState } from "react";
import { useT } from "./i18n";

export type ConfirmPayload = {
  title: string;
  message: string;
  ok?: string;
  cancel?: string;
};

export function useConfirm() {
  const [payload, setPayload] = useState<ConfirmPayload | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  function ask(next: ConfirmPayload) {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPayload(next);
    });
  }

  function finish(ok: boolean) {
    const resolve = resolver.current;
    resolver.current = null;
    setPayload(null);
    resolve?.(ok);
  }

  const dialog = payload ? (
    <ConfirmDialog
      title={payload.title}
      message={payload.message}
      ok={payload.ok}
      cancel={payload.cancel}
      onOk={() => finish(true)}
      onCancel={() => finish(false)}
    />
  ) : null;

  return [ask, dialog] as const;
}

export default function ConfirmDialog({
  title,
  message,
  ok,
  cancel,
  onOk,
  onCancel,
}: ConfirmPayload & {
  onOk: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="confirm-backdrop" onMouseDown={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title">{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            {cancel || t("cancel", "Abbrechen")}
          </button>
          <button type="button" className="ghost-btn confirm-ok" onClick={onOk}>
            {ok || t("ok", "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
