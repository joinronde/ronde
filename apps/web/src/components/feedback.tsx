"use client";

import { Modal } from "@ronde/ui/modal";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { FormAlert } from "@/components/auth/fields";
import { Icon, type IconName } from "@/components/shell/icons";
import { BASE_PATH, withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";

// "Send feedback": something broken, an idea. Opened from the top bar, the account menu and the error page; the
// message goes to the Ronde team (cloud) or to the instance's administrators, with a screenshot when wanted.

/** Who reads the messages: the Ronde team, or the administrators of this server */
export type FeedbackTo = "team" | "admins";
type Kind = "bug" | "idea" | "other";

const KINDS: { id: Kind; icon: IconName }[] = [
  { id: "bug", icon: "bug" },
  { id: "idea", icon: "bulb" },
  { id: "other", icon: "chat" },
];

const MAX_LENGTH = 5000;
/** Longest side of a screenshot sent, and its weight at most (the server keeps it at that size) */
const SHOT_SIDE = 1920;
const SHOT_MAX_BYTES = 3_500_000;

interface Draft {
  kind: Kind;
  message: string;
  contact: boolean;
  shot: Blob | null;
}

/**
 * What was written and not sent: a dialog closed by mistake gives it back, to the same account only (another
 * person signing in on a shared computer never sees it)
 */
let kept: { owner: string; draft: Draft } | null = null;

/** Signing out forgets the unsent message */
export const forgetFeedbackDraft = () => {
  kept = null;
};

/** The instance's choice, given by the root layout; null without it, or for someone not signed in */
export function feedbackSetting(): FeedbackTo | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="ronde-feedback"]');
  const v = meta?.content;
  return meta?.dataset.signedIn === "1" && (v === "team" || v === "admins") ? v : null;
}

/** An image drawn at most 1920 px wide or high, in WebP (JPEG where the browser cannot), on a white background */
async function encode(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, SHOT_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const [type, quality] of [
    ["image/webp", 0.85],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.6],
  ] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // Safari answers PNG when asked for WebP: the next format is tried
    if (blob && blob.type === type && blob.size <= SHOT_MAX_BYTES) return blob;
  }
  throw new Error("size");
}

async function fromFile(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return await encode(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** One picture of this tab, through the browser's screen sharing (it asks first); the dialog is hidden meanwhile */
async function captureTab(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
  } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The browser's sharing bar may move the page: a moment to settle, then a fresh frame
    await new Promise((r) => setTimeout(r, 350));
    if ("requestVideoFrameCallback" in video) await new Promise((r) => video.requestVideoFrameCallback(() => r(null)));
    return await encode(video, video.videoWidth, video.videoHeight);
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

export function FeedbackDialog({
  to,
  email,
  workspace,
  errorRef,
  kind: firstKind,
  onClose,
}: {
  to: FeedbackTo;
  /** The account's address, shown next to the "answer me" box */
  email?: string;
  /** The workspace open (its slug) */
  workspace?: string | null;
  /** Reference of the error on the page that opened the dialog */
  errorRef?: string;
  kind?: Kind;
  onClose: () => void;
}) {
  const t = useTranslations("feedback");
  const titleId = useId();
  const hintId = useId();
  const owner = email ?? "";
  // Answering is asked for, never assumed: the box starts unticked
  const [draft, setDraft] = useState<Draft>(() =>
    kept?.owner === owner
      ? { ...kept.draft, kind: firstKind ?? kept.draft.kind }
      : { kind: firstKind ?? "bug", message: "", contact: false, shot: null },
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shotRef = useRef<HTMLDivElement>(null);

  // Screen sharing exists on computers only
  useEffect(() => {
    setCanCapture(!!navigator.mediaDevices?.getDisplayMedia && !matchMedia("(pointer: coarse)").matches);
  }, []);
  useEffect(() => {
    if (!draft.shot) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(draft.shot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.shot]);
  // What is not sent stays for the next opening
  useEffect(() => {
    kept = sent ? null : { owner, draft };
  }, [draft, sent, owner]);
  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const attach = async (file: Blob) => {
    setError(null);
    try {
      set({ shot: await fromFile(file) });
    } catch {
      setError(t("imageUnreadable"));
    }
  };

  const capture = async () => {
    setError(null);
    setShooting(true);
    document.documentElement.dataset.feedbackShot = "";
    try {
      set({ shot: await captureTab() });
    } catch (e) {
      // Sharing refused: nothing to say, the person chose it
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) setError(t("captureFailed"));
    } finally {
      delete document.documentElement.dataset.feedbackShot;
      setShooting(false);
      requestAnimationFrame(() => shotRef.current?.querySelector<HTMLElement>("button")?.focus());
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !draft.message.trim()) return;
    setBusy(true);
    setError(null);
    const path = location.pathname.startsWith(BASE_PATH) ? location.pathname.slice(BASE_PATH.length) || "/" : location.pathname;
    const theme = document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const form = new FormData();
    form.set(
      "data",
      JSON.stringify({
        kind: draft.kind,
        message: draft.message.trim(),
        contact: draft.contact,
        workspace: workspace ?? undefined,
        path,
        viewport: `${innerWidth}×${innerHeight}`,
        theme,
        errorRef,
      }),
    );
    if (draft.shot) form.set("screenshot", draft.shot, "screenshot");
    try {
      const res = await fetch(withBasePath("/api/feedback"), { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? t("failed"));
        return;
      }
      track("feedback_sent", { kind: draft.kind, screenshot: draft.shot ? 1 : 0 });
      setSent(true);
    } catch {
      setError(t("offline"));
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Modal onClose={onClose} labelledBy={titleId}>
        <div className="form dialog-form narrow feedback-done" role="status">
          <span className="feedback-done-mark" aria-hidden="true">
            <Icon name="check" size={28} />
          </span>
          <h2 id={titleId}>{t("doneTitle")}</h2>
          <p>
            {to === "team" ? t("doneTeam") : t("doneAdmins")} {draft.contact && (email ? t("doneContactAt", { email }) : t("doneContact"))}
          </p>
          <div className="dialog-actions">
            <button type="button" ref={doneRef} className="btn primary" onClick={onClose}>
              {t("close")}
            </button>
          </div>
        </div>
      </Modal>
    );

  const near = draft.message.length > MAX_LENGTH - 500;
  const remaining = MAX_LENGTH - draft.message.length;
  const left = remaining <= 0 ? 0 : remaining <= 100 ? 100 : remaining <= 500 ? 500 : null;
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form
        className="form dialog-form feedback-form"
        data-dragging={dragging || undefined}
        aria-describedby={hintId}
        onSubmit={submit}
        onPaste={(e) => {
          const file = [...e.clipboardData.items].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
          if (!file) return;
          e.preventDefault();
          void attach(file);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          setDragging(false);
          if (!e.dataTransfer.types.includes("Files")) return;
          // Never let the browser open a dropped file in place of the page (the draft would be lost)
          e.preventDefault();
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
          if (file) void attach(file);
          else setError(t("imageUnreadable"));
        }}
      >
        <div className="feedback-head">
          <span className="feedback-mark" aria-hidden="true">
            <Icon name="feedback" size={20} />
          </span>
          <div>
            <h2 id={titleId}>{t("title")}</h2>
            <p className="hint" id={hintId}>
              {to === "team" ? t("introTeam") : t("introAdmins")}
            </p>
          </div>
        </div>
        <FormAlert>{error}</FormAlert>
        <fieldset className="plain">
          <legend className="lbl-s">{t("about")}</legend>
          <div className="feedback-kinds">
            {KINDS.map((k) => (
              <label key={k.id} className={draft.kind === k.id ? "on" : undefined}>
                <input type="radio" name="kind" value={k.id} checked={draft.kind === k.id} onChange={() => set({ kind: k.id })} />
                <Icon name={k.icon} size={18} />
                <span>{t(`kinds.${k.id}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor={`${titleId}-message`}>{t("message")}</label>
          <textarea
            id={`${titleId}-message`}
            data-autofocus
            required
            rows={5}
            maxLength={MAX_LENGTH}
            placeholder={t(`placeholders.${draft.kind}`)}
            value={draft.message}
            onChange={(e) => set({ message: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
          {near && <span className="hint feedback-count">{t("count", { count: draft.message.length, max: MAX_LENGTH })}</span>}
          {/* Said at 500, 100 and no characters left, not at every key */}
          <span className="sr-only" aria-live="polite">
            {left === null ? "" : t("left", { count: left })}
          </span>
        </div>
        <div className="feedback-shot" ref={shotRef}>
          <span className="lbl-s">{t("screenshot")}</span>
          {preview ? (
            <div className="feedback-preview">
              <a href={preview} target="_blank" rel="noreferrer" title={t("openScreenshot")}>
                <img src={preview} alt={t("screenshotAlt")} />
              </a>
              <div>
                <p className="hint">{t("screenshotCheck")}</p>
                <button type="button" className="btn sm" onClick={() => set({ shot: null })}>
                  <Icon name="close" size={14} /> {t("removeScreenshot")}
                </button>
              </div>
            </div>
          ) : (
            <div className="feedback-drop">
              {canCapture && (
                <button type="button" className="btn sm" onClick={() => void capture()} disabled={shooting} aria-busy={shooting}>
                  <Icon name="camera" size={16} /> {t("capture")}
                </button>
              )}
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                <Icon name="image" size={16} /> {t("addImage")}
              </button>
              <span className="hint">{t("pasteHint")}</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void attach(file);
                }}
              />
            </div>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.contact} onChange={(e) => set({ contact: e.target.checked })} />
          <span>{email ? t("contactAt", { email }) : t("contact")}</span>
        </label>
        <p className="hint feedback-sent-with">
          <Icon name="lock" size={14} /> {t("sentWith")}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !draft.message.trim()} aria-busy={busy}>
            {busy ? t("sending") : t("send")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
