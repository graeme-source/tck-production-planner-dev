/**
 * Rich-text editor + renderer for customer survey text (the intro under the
 * survey heading, and the optional final page). Big iPad-friendly toolbar:
 * bold / italic / underline, heading sizes, text size, a small set of safe
 * fonts, bullet + numbered lists, links, left/centre alignment, undo/redo.
 *
 * Fonts, sizes and alignment are CLASSES (no inline styles) so the server's
 * strict allow-list can keep them and the website styles them itself. The
 * server re-sanitises everything (api-server/src/lib/survey-intro.ts).
 * Objective I.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, Extension, Mark, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Italic, Underline, List, ListOrdered, Link2, Link2Off, AlignLeft, AlignCenter, Undo2, Redo2, Heading2, Heading3, Pilcrow, Check, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SURVEY_FONTS, SURVEY_SIZES, alignFromClass, fontClass, fontKeyFromClass, isRichTextEmpty, sizeClass, sizeKeyFromClass,
  type SurveyAlign, type SurveyFontKey, type SurveySizeKey,
} from "@/lib/survey-rich-text";
import "./survey-rich-text.css";

// ── Extensions ──────────────────────────────────────────────────────────────

const FontMark = Mark.create({
  name: "tckFont",
  addAttributes() {
    return {
      font: {
        default: null,
        parseHTML: (el: HTMLElement) => fontKeyFromClass(el.getAttribute("class")),
        renderHTML: (attrs: { font?: string | null }) => {
          const cls = fontClass(attrs.font);
          return cls ? { class: cls } : {};
        },
      },
    };
  },
  // consuming: false — one <span> can carry a font AND a size class.
  parseHTML() {
    return [{ tag: "span", consuming: false, getAttrs: (el: HTMLElement) => (fontKeyFromClass(el.getAttribute("class")) ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) { return ["span", HTMLAttributes, 0]; },
});

const SizeMark = Mark.create({
  name: "tckSize",
  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (el: HTMLElement) => sizeKeyFromClass(el.getAttribute("class")),
        renderHTML: (attrs: { size?: string | null }) => {
          const cls = sizeClass(attrs.size);
          return cls ? { class: cls } : {};
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "span", consuming: false, getAttrs: (el: HTMLElement) => (sizeKeyFromClass(el.getAttribute("class")) ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) { return ["span", HTMLAttributes, 0]; },
});

const AlignAttr = Extension.create({
  name: "tckAlign",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        align: {
          default: null,
          parseHTML: (el: HTMLElement) => alignFromClass(el.getAttribute("class")),
          renderHTML: (attrs: { align?: string | null }) => (attrs.align ? { class: `tck-align-${attrs.align}` } : {}),
        },
      },
    }];
  },
});

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    strike: false,
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    },
  }),
  FontMark,
  SizeMark,
  AlignAttr,
];

// ── Toolbar ─────────────────────────────────────────────────────────────────

function ToolButton({ active, disabled, onClick, title, children, className }: {
  active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      // Keep the editor's selection while tapping the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "h-11 min-w-11 px-2.5 rounded-lg border text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border hover:bg-muted",
        disabled && "opacity-40 pointer-events-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Group({ children, label }: { children: ReactNode; label: string }) {
  return <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">{children}</div>;
}

function currentAlign(editor: Editor): SurveyAlign | null {
  const node = editor.state.selection.$from.parent;
  return (node.attrs as { align?: SurveyAlign | null }).align ?? null;
}

function Toolbar({ editor, defaultAlign }: { editor: Editor; defaultAlign: SurveyAlign }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
      href: (e.getAttributes("link") as { href?: string }).href ?? "",
      font: ((e.getAttributes("tckFont") as { font?: SurveyFontKey }).font ?? "body") as SurveyFontKey,
      size: ((e.getAttributes("tckSize") as { size?: SurveySizeKey }).size ?? "normal") as SurveySizeKey,
      align: currentAlign(e) ?? defaultAlign,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const chain = () => editor.chain().focus();

  function setFont(font: SurveyFontKey) {
    if (font === "body") chain().unsetMark("tckFont").run();
    else chain().setMark("tckFont", { font }).run();
  }
  function setSize(size: SurveySizeKey) {
    if (size === "normal") chain().unsetMark("tckSize").run();
    else chain().setMark("tckSize", { size }).run();
  }
  function setAlign(align: SurveyAlign) {
    const value = align === defaultAlign ? null : align;
    chain().updateAttributes("paragraph", { align: value }).updateAttributes("heading", { align: value }).run();
  }
  function openLink() {
    setLinkText(s.href);
    setLinkError(null);
    setLinkOpen(true);
  }
  function applyLink() {
    let href = linkText.trim();
    if (!href) { chain().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); return; }
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(href)) href = `mailto:${href}`;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`;
    if (!/^(https?:\/\/|mailto:)/i.test(href)) {
      setLinkError("Links must start with https://, http:// or be an email address.");
      return;
    }
    if (editor.state.selection.empty && !s.link) {
      // Nothing selected: insert the address itself as the link text.
      chain().insertContent({ type: "text", text: href.replace(/^mailto:/i, ""), marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  }

  return (
    <div className="border-b border-border bg-muted/40 p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Group label="Style">
          <ToolButton title="Bold" active={s.bold} onClick={() => chain().toggleBold().run()}><Bold className="w-5 h-5" /></ToolButton>
          <ToolButton title="Italic" active={s.italic} onClick={() => chain().toggleItalic().run()}><Italic className="w-5 h-5" /></ToolButton>
          <ToolButton title="Underline" active={s.underline} onClick={() => chain().toggleUnderline().run()}><Underline className="w-5 h-5" /></ToolButton>
        </Group>
        <Group label="Paragraph type">
          <ToolButton title="Normal text" active={!s.h2 && !s.h3} onClick={() => chain().setParagraph().run()}><Pilcrow className="w-5 h-5" /></ToolButton>
          <ToolButton title="Heading" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 className="w-5 h-5" /></ToolButton>
          <ToolButton title="Subheading" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 className="w-5 h-5" /></ToolButton>
        </Group>
        <Group label="Lists">
          <ToolButton title="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}><List className="w-5 h-5" /></ToolButton>
          <ToolButton title="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered className="w-5 h-5" /></ToolButton>
        </Group>
        <Group label="Alignment">
          <ToolButton title="Align left" active={s.align === "left"} onClick={() => setAlign("left")}><AlignLeft className="w-5 h-5" /></ToolButton>
          <ToolButton title="Centre" active={s.align === "center"} onClick={() => setAlign("center")}><AlignCenter className="w-5 h-5" /></ToolButton>
        </Group>
        <Group label="Link">
          <ToolButton title={s.link ? "Edit link" : "Add link"} active={s.link || linkOpen} onClick={openLink}><Link2 className="w-5 h-5" /></ToolButton>
          {s.link && (
            <ToolButton title="Remove link" onClick={() => chain().extendMarkRange("link").unsetLink().run()}><Link2Off className="w-5 h-5" /></ToolButton>
          )}
        </Group>
        <Group label="Undo">
          <ToolButton title="Undo" disabled={!s.canUndo} onClick={() => chain().undo().run()}><Undo2 className="w-5 h-5" /></ToolButton>
          <ToolButton title="Redo" disabled={!s.canRedo} onClick={() => chain().redo().run()}><Redo2 className="w-5 h-5" /></ToolButton>
        </Group>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Group label="Text size">
          <span className="text-xs text-muted-foreground mr-1">Size</span>
          {SURVEY_SIZES.map(z => (
            <ToolButton key={z.key} title={`${z.label} text`} active={s.size === z.key} onClick={() => setSize(z.key)}>
              <span className={z.cls ?? undefined}>{z.label}</span>
            </ToolButton>
          ))}
        </Group>
        <Group label="Font">
          <span className="text-xs text-muted-foreground mr-1">Font</span>
          {SURVEY_FONTS.map(f => (
            <ToolButton key={f.key} title={f.label} active={s.font === f.key} onClick={() => setFont(f.key)}>
              <span className={f.cls ?? undefined}>{f.label}</span>
            </ToolButton>
          ))}
        </Group>
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={linkText}
            onChange={(e) => { setLinkText(e.target.value); setLinkError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") { e.preventDefault(); setLinkOpen(false); }
            }}
            placeholder="https://thecalzonekitchen.co.uk/… or an email address"
            className="h-11 flex-1 min-w-[14rem] rounded-lg border border-border bg-background px-3 text-sm"
          />
          <ToolButton title="Apply link" onClick={applyLink} className="px-4"><Check className="w-5 h-5" /> Apply</ToolButton>
          <ToolButton title="Cancel" onClick={() => setLinkOpen(false)}><X className="w-5 h-5" /></ToolButton>
          {linkError && <p className="w-full text-sm text-destructive">{linkError}</p>}
        </div>
      )}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

export function SurveyRichTextEditor({ value, onChange, placeholder, defaultAlign = "center", ariaLabel }: {
  /** HTML ("" = empty). */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** How the page shows paragraphs with no alignment set (the site centres). */
  defaultAlign?: SurveyAlign;
  ariaLabel: string;
}) {
  // Last HTML this editor emitted — so a parent echoing it back doesn't
  // reset the content (and the cursor), but a genuinely new value does.
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value || "",
    editorProps: {
      attributes: {
        class: cn("tck-rich", defaultAlign === "center" && "tck-rich--center"),
        "aria-label": ariaLabel,
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      const emitted = isRichTextEmpty(html) ? "" : html;
      lastEmitted.current = emitted;
      onChangeRef.current(emitted);
    },
  });

  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  return (
    <div className="tck-rich-editor rounded-xl border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring">
      <Toolbar editor={editor} defaultAlign={defaultAlign} />
      <div className="relative text-base">
        {!value && placeholder && (
          <p className={cn("pointer-events-none absolute inset-x-4 top-3 text-muted-foreground", defaultAlign === "center" && "text-center")}>
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── Renderer (preview) ──────────────────────────────────────────────────────

/**
 * Shows survey HTML the way the website does. Only ever given HTML that the
 * server sanitised, or this page's own editor output (TipTap's schema only
 * produces the allowed tags).
 */
export function SurveyRichText({ html, className, center = true }: { html: string; className?: string; center?: boolean }) {
  return (
    <div
      className={cn("tck-rich", center && "tck-rich--center", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
