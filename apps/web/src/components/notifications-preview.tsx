"use client";

import type { Block, NotifyInput, RichMessage } from "@ronde/core/notify";
import { first, isCheckInReady } from "@ronde/core/util";
import { BellOff, Mail, MessageSquare, Smartphone, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { withBasePath } from "@/lib/shared/base-path";
import { type PreviewChannel, previewChannels, previewMessage } from "@/lib/shared/notify-preview";
import { useRonde } from "./ronde-provider";

// What the meeting's notifications will look like, one tab per channel that sends: the reminder email when it
// is on, then each connector with a rule turned on, every rule's message drawn the way that channel shows it

const KIND_ICON = { email: Mail, sms: Smartphone, whatsapp: Smartphone, webhook: Webhook } as const;

export function NotificationsPreview({ reminder }: { reminder: React.ReactNode }) {
  const t = useTranslations("notifyRules");
  const tKinds = useTranslations("connectors.kinds");
  const { s } = useRonde();
  const channels = previewChannels(s.settings.reminderEnabled, s.notifications?.connectors ?? [], s.notifications?.rules ?? []);
  const [tab, setTab] = useState<string | null>(null);
  const current = channels.find((c) => c.id === tab) ?? channels[0];
  return (
    <div className="panel notify-preview">
      <h3>{t("preview.title")}</h3>
      {!current ? (
        <div className="emptybox notify-preview-empty">
          <BellOff size={22} strokeWidth={2} aria-hidden="true" />
          <p>{t("preview.none")}</p>
        </div>
      ) : (
        <>
          {channels.length > 1 && (
            <div className="subtabs">
              <div className="subtabs-list" role="tablist" aria-label={t("preview.channels")}>
                {channels.map((c) => {
                  const KindIcon = c.kind === "reminder" ? Mail : (KIND_ICON[c.kind as keyof typeof KIND_ICON] ?? MessageSquare);
                  return (
                    <button key={c.id} type="button" role="tab" aria-selected={c.id === current.id} onClick={() => setTab(c.id)}>
                      <KindIcon size={15} strokeWidth={2} aria-hidden="true" />
                      {c.kind === "reminder" ? t("preview.reminder") : `${c.name} · ${tKinds(c.kind)}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div role={channels.length > 1 ? "tabpanel" : undefined}>
            {current.kind === "reminder" ? reminder : <ChannelPreview channel={current} />}
          </div>
        </>
      )}
    </div>
  );
}

/** Every rule of a connector, as its channel would show it */
function ChannelPreview({ channel }: { channel: Exclude<PreviewChannel, { kind: "reminder" }> }) {
  const t = useTranslations("notifyRules");
  const { s } = useRonde();
  // Links in the messages are absolute, as in the ones sent: the address of this app, known once in the browser
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const active = s.members.filter((m) => m.active);
  const names = active.map((m) => first(m.name));
  const next = s.settings.schedule.upcoming.find((o) => !o.cancelled);
  const sample = t("preview.sampleAction");
  const base: Omit<NotifyInput, "event"> = {
    settings: s.settings,
    locale: s.settings.locale,
    meetingUrl: origin ? `${origin}${withBasePath(s.context.path)}` : "",
    session: {
      date: s.meeting?.date ?? next?.date ?? new Date().toISOString().slice(0, 10),
      time: s.meeting?.time ?? next?.time ?? "10:00",
    },
    progress: { ready: active.filter((m) => isCheckInReady(s.checkIns[m.id], s.lastArchivedAt)).length, total: active.length },
    minutes: {
      durationMs: s.settings.targetMin * 60_000,
      participants: active.length,
      decisions: [t("preview.sampleDecision")],
      actions: [{ text: sample, owner: names[0] ?? "" }],
    },
    names: names.slice(0, 1),
  };
  // Message keys cannot hold dots: "session.soon" is "events.session_soon"
  const eventLabel = (event: string) => t(`events.${event.replace(".", "_")}` as "events.birthday");
  return (
    <ul className={`np-list np-${channel.kind}`}>
      {channel.rules.map((r) => {
        const message = previewMessage(
          {
            ...base,
            event: r.event,
            minutesBefore: r.options.minutesBefore ?? 10,
            overdue: [{ text: sample, owner: names[0] ?? "", days: r.options.days ?? 7 }],
          },
          r.message,
        );
        return (
          <li key={r.id}>
            <p className="np-when">
              {t("preview.onLabel")} <strong>{eventLabel(r.event)}</strong>
              {r.target.audience && (
                <span className="hint"> · {t(r.target.audience === "hosts" ? "audienceHosts" : "audienceParticipants")}</span>
              )}
            </p>
            <Message kind={channel.kind} name={s.settings.teamName} message={message} />
          </li>
        );
      })}
    </ul>
  );
}

/** One message as the channel shows it: a chat post, an email, a text message or the payload of a webhook */
function Message({ kind, name, message }: { kind: string; name: string; message: RichMessage }) {
  const t = useTranslations("notifyRules");
  if (kind === "email")
    return (
      <div className="np-mail">
        <div className="np-mail-subject">{message.summary}</div>
        <div className="np-mail-body">
          <Blocks blocks={message.blocks.slice(message.blocks[0]?.kind === "title" ? 1 : 0)} />
        </div>
      </div>
    );
  if (kind === "sms" || kind === "whatsapp")
    return (
      <div className="np-phone">
        <div className="np-bubble">
          <Blocks blocks={message.blocks} plain />
        </div>
      </div>
    );
  return (
    <div className="np-chat">
      <img className="np-app" src={withBasePath("/icon.png")} alt="" width={36} height={36} />
      <div className="np-post">
        <div className="np-head">
          <strong>Ronde</strong>
          <span className="np-tag">{t("preview.app")}</span>
          <span className="hint">{name}</span>
        </div>
        <div className="np-card">
          <Blocks blocks={message.blocks} />
        </div>
      </div>
    </div>
  );
}

function Blocks({ blocks, plain }: { blocks: Block[]; plain?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        const key = `${b.kind}-${i}`;
        if (b.kind === "title")
          return (
            <p key={key} className="np-title">
              {b.text}
            </p>
          );
        if (b.kind === "text")
          return (
            <p key={key} className="np-text">
              {b.text}
            </p>
          );
        if (b.kind === "facts")
          return (
            <dl key={key} className="np-facts">
              {b.items.map((x) => (
                <div key={x.label}>
                  <dt>{x.label}</dt>
                  <dd>{x.value}</dd>
                </div>
              ))}
            </dl>
          );
        if (b.kind === "list")
          return (
            <ul key={key} className="np-items">
              {b.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          );
        return plain ? (
          <p key={key} className="np-text">
            {b.label} : <span className="np-url">{b.url}</span>
          </p>
        ) : (
          <span key={key} className="np-link">
            {b.label}
          </span>
        );
      })}
    </>
  );
}
