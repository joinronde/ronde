"use client";

import { Modal } from "@ronde/ui/modal";
import { useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";

interface Ask {
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

/** Confirmation dialog replacing window.confirm: `await ask({...})` resolves to true when confirmed */
export function useConfirm(): [React.ReactNode, (ask: Ask) => Promise<boolean>] {
  const t = useTranslations("common");
  const titleId = useId();
  const [pending, setPending] = useState<Ask | null>(null);
  const resolver = useRef<(ok: boolean) => void>(() => {});
  const ask = useCallback((a: Ask) => {
    setPending(a);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const answer = (ok: boolean) => {
    setPending(null);
    resolver.current(ok);
  };
  const dialog = pending && (
    <Modal onClose={() => answer(false)} labelledBy={titleId}>
      <div className="form dialog-form narrow">
        <p id={titleId} className="confirm-text">
          {pending.message}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => answer(false)}>
            {t("cancel")}
          </button>
          <button type="button" className={`btn ${pending.danger ? "danger-solid" : "primary"}`} onClick={() => answer(true)}>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
  return [dialog, ask];
}
