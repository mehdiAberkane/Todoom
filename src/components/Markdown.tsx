import { Fragment, useMemo } from "react";
import { parseMarkdown, type Block, type Inline } from "../lib/markdown";
import { openExternal } from "../lib/open";
import { t } from "../lib/i18n";

/**
 * Markdown shown as React elements built from the parsed tree: React escapes
 * every piece of text, and no HTML from the ticket is ever inserted.
 * Links open in the system's browser. With `onToggleTask`, checkboxes can be ticked.
 */
export function Markdown({ text, onToggleTask }: { text: string; onToggleTask?: (line: number) => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="markdown">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} onToggleTask={onToggleTask} />
      ))}
    </div>
  );
}

function BlockView({ block, onToggleTask }: { block: Block; onToggleTask?: (line: number) => void }) {
  switch (block.t) {
    case "h": {
      // Headings stay modest inside a card: # is the largest, ##### and ###### the same as ####.
      const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[block.level - 1];
      return (
        <Tag className={`md-h md-h${block.level}`}>
          <Inlines nodes={block.c} />
        </Tag>
      );
    }
    case "p":
      return (
        <p>
          <Lines lines={block.lines} />
        </p>
      );
    case "quote":
      return (
        <blockquote>
          <Lines lines={block.lines} />
        </blockquote>
      );
    case "code":
      return (
        <pre className="md-code" data-lang={block.lang || undefined}>
          <code>{block.v}</code>
        </pre>
      );
    case "hr":
      return <hr />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="md-list">
          {block.items.map((item) => (
            <li key={item.line} className={item.task !== null ? "md-task" : undefined} style={item.level ? { marginLeft: item.level * 18 } : undefined}>
              {item.task !== null && (
                <input
                  type="checkbox"
                  checked={item.task}
                  disabled={!onToggleTask}
                  onChange={() => onToggleTask?.(item.line)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <span className={item.task ? "md-done" : undefined}>
                <Inlines nodes={item.c} />
              </span>
            </li>
          ))}
        </Tag>
      );
    }
  }
}

function Lines({ lines }: { lines: Inline[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inlines nodes={line} />
        </Fragment>
      ))}
    </>
  );
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "code":
            return <code key={i}>{n.v}</code>;
          case "path":
            return (
              <code key={i} className="md-path">
                {n.v}
              </code>
            );
          case "strong":
            return (
              <strong key={i}>
                <Inlines nodes={n.c} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case "link":
            return (
              <a
                key={i}
                href={n.href}
                title={n.href}
                rel="noreferrer noopener"
                onClick={(e) => {
                  // Never navigate inside the app's window: the system's browser opens it.
                  e.preventDefault();
                  e.stopPropagation();
                  openExternal(n.href);
                }}
              >
                <Inlines nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

/** Read view of a text with a button to edit it; a click on the text (not on a link or box) edits it too. */
export function MarkdownView({ text, onEdit, onToggleTask }: { text: string; onEdit: () => void; onToggleTask?: (line: number) => void }) {
  return (
    <div className="md-view" onClick={(e) => (e.target as HTMLElement).closest("a, input") || onEdit()} title={t("md.clickToEdit")}>
      <Markdown text={text} onToggleTask={onToggleTask} />
    </div>
  );
}
