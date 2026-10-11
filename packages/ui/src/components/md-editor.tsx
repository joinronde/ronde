"use client";

import { markdownToHtml } from "@ronde/core/markdown";
import { docToMarkdown } from "@ronde/core/rich-text";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Selection } from "@tiptap/pm/state";
import { type Editor, EditorContent, Extension, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

// A rich text editor for the notes and the minutes: bold, italic, underline, strikethrough, lists and sub-lists,
// links, formatted as it is typed (and as it is pasted from a document). What it stores is the Markdown that
// the minutes, the PDF and the emails read (@ronde/core/markdown), written back at every change.

type Props = {
  id: string;
  label: string;
  /** Markdown */
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  /** Extra buttons, at the right of the toolbar: they add Markdown as a new line at the end */
  extra?: (insert: (markdown: string) => void) => React.ReactNode;
  /** The editable element, to focus it or to know whether it has the focus */
  inputRef?: React.RefObject<HTMLElement | null>;
};

/** The caret at the end of the text, without taking the focus */
const atEnd = (e: Editor) =>
  e.commands.command(({ tr }) => {
    tr.setSelection(Selection.atEnd(tr.doc));
    return true;
  });

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const webUrl = (s: string) => {
  const v = s.trim();
  if (!v) return "";
  const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
};

export function MdEditor(p: Props) {
  const t = useTranslations("editor");
  // The editor is created once: its callbacks read the latest props from here
  const props = useRef(p);
  props.current = p;
  // The Markdown the editor holds: a value coming back equal to it is the editor's own, not to reload
  const held = useRef(p.value);
  const [link, setLink] = useState<string | null>(null);
  const openLink = useRef<() => void>(() => {});
  // Shortcuts shown for the operating system, once in the browser (the server render does not know it)
  const [mod, setMod] = useState("Ctrl+");
  const [shift, setShift] = useState("Shift+");
  useEffect(() => {
    setMod(isMac() ? "⌘" : "Ctrl+");
    setShift(isMac() ? "⇧" : t("shiftKey"));
  }, [t]);

  const editor = useEditor({
    // Drawn in the browser only: the server does not render the editable document
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https"] },
      }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: () => props.current.placeholder ?? "" }),
      Extension.create({
        name: "linkShortcut",
        addKeyboardShortcuts: () => ({
          "Mod-k": () => {
            openLink.current();
            return true;
          },
        }),
      }),
    ],
    content: markdownToHtml(p.value),
    editorProps: {
      attributes: { id: p.id, role: "textbox", "aria-multiline": "true", "aria-label": p.label, class: "md-input" },
    },
    onUpdate: ({ editor: e }) => {
      const md = docToMarkdown(e.getJSON());
      if (md === held.current) return;
      held.current = md;
      props.current.onChange(md);
    },
    onBlur: () => props.current.onBlur?.(),
    // Typing goes on after what is there, not before it
    onCreate: ({ editor: e }) => atEnd(e),
  });

  // A value set from outside (another step's notes, a reload): the editor takes it, without echoing it back
  useEffect(() => {
    if (!editor || p.value === held.current) return;
    held.current = p.value;
    editor.commands.setContent(markdownToHtml(p.value), { emitUpdate: false });
    atEnd(editor);
  }, [editor, p.value]);

  useEffect(() => {
    if (p.inputRef) p.inputRef.current = editor ? (editor.view.dom as HTMLElement) : null;
  }, [editor, p.inputRef]);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            link: e.isActive("link"),
            sink: e.can().sinkListItem("listItem"),
            lift: e.can().liftListItem("listItem"),
          }
        : null,
  });

  openLink.current = () => {
    if (!editor) return;
    const href = editor.getAttributes("link").href as string | undefined;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to).trim();
    setLink(href ?? (webUrl(selected) ? selected : ""));
  };

  const applyLink = () => {
    if (!editor || link === null) return;
    const href = webUrl(link);
    if (href === null) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link"))
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    setLink(null);
  };

  /** Markdown added as a new line at the end, the caret after it, typing on without its formatting */
  const insert = (markdown: string) => {
    if (!editor) return;
    const doc = editor.state.doc;
    const end = doc.content.size;
    const last = doc.lastChild;
    // An empty last line is filled rather than followed
    const at = last && last.type.name === "paragraph" && !last.textContent ? { from: end - last.nodeSize, to: end } : end;
    editor
      .chain()
      .insertContentAt(at, markdownToHtml(markdown))
      .focus("end")
      .command(({ tr }) => {
        tr.setStoredMarks([]);
        return true;
      })
      .insertContent(" ")
      .run();
  };

  const btn = (label: React.ReactNode, title: string, act: () => void, pressed?: boolean, disabled = false) => (
    <button
      type="button"
      className="md-btn"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={!editor || disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={act}
    >
      {label}
    </button>
  );
  const run = (f: (c: NonNullable<typeof editor>) => void) => () => editor && f(editor);

  return (
    <div className={"md-editor " + (p.className ?? "")}>
      <div className="md-bar" role="toolbar" aria-label={t("toolbar", { label: p.label })} aria-controls={p.id}>
        {btn(
          <b>{t("boldLetter")}</b>,
          t("bold", { key: `${mod}B` }),
          run((e) => e.chain().focus().toggleBold().run()),
          active?.bold,
        )}
        {btn(
          <i>{t("italicLetter")}</i>,
          t("italic", { key: `${mod}I` }),
          run((e) => e.chain().focus().toggleItalic().run()),
          active?.italic,
        )}
        {btn(
          <u>{t("underlineLetter")}</u>,
          t("underline", { key: `${mod}U` }),
          run((e) => e.chain().focus().toggleUnderline().run()),
          active?.underline,
        )}
        {btn(
          <s>{t("strikeLetter")}</s>,
          t("strike", { key: `${mod}${shift}S` }),
          run((e) => e.chain().focus().toggleStrike().run()),
          active?.strike,
        )}
        <span className="md-sep" />
        {btn(
          "•",
          t("bulletList"),
          run((e) => e.chain().focus().toggleBulletList().run()),
          active?.bullet,
        )}
        {btn(
          "1.",
          t("numberedList"),
          run((e) => e.chain().focus().toggleOrderedList().run()),
          active?.ordered,
        )}
        {btn(
          "⇥",
          t("indent"),
          run((e) => e.chain().focus().sinkListItem("listItem").run()),
          undefined,
          !active?.sink,
        )}
        {btn(
          "⇤",
          t("outdent", { key: `${shift}Tab` }),
          run((e) => e.chain().focus().liftListItem("listItem").run()),
          undefined,
          !active?.lift,
        )}
        <span className="md-sep" />
        {btn("🔗", t("link", { key: `${mod}K` }), () => openLink.current(), active?.link)}
        {p.extra && <span className="md-sep" />}
        {p.extra?.(insert)}
      </div>
      {link !== null && (
        // A group, not a form: the editor can sit inside one (a project's form), and forms do not nest
        <div
          className="md-link"
          role="group"
          aria-label={t("linkUrl")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyLink();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setLink(null);
              editor?.commands.focus();
            }
          }}
        >
          <input
            type="text"
            inputMode="url"
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
            aria-label={t("linkUrl")}
            aria-invalid={webUrl(link) === null}
          />
          <button type="button" className="btn sm primary" disabled={webUrl(link) === null} onClick={applyLink}>
            {t("linkApply")}
          </button>
          {active?.link && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                setLink(null);
              }}
            >
              {t("linkRemove")}
            </button>
          )}
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              setLink(null);
              editor?.commands.focus();
            }}
          >
            {t("linkCancel")}
          </button>
        </div>
      )}
      <EditorContent editor={editor} className="md-field" />
    </div>
  );
}
