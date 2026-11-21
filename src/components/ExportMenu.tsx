import { useState } from "react";
import type { Board, Card } from "../types";
import { boardCsv, boardMarkdown, exportFileName } from "../lib/exporter";
import { backend } from "../lib/backend";
import { getLang, t } from "../lib/i18n";

/** ⇩ in the board's header: the board as Markdown or CSV, saved as a file or copied. */
export function ExportMenu({ board, cards }: { board: Board; cards: Card[] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const flash = (text: string) => {
    setDone(text);
    setTimeout(() => setDone(null), 2500);
  };

  const save = async (ext: "md" | "csv", content: string) => {
    setOpen(false);
    try {
      if (await backend.saveExport(exportFileName(board, ext), content)) flash(t("export.saved"));
    } catch (e) {
      flash(t("export.failed", { error: String(e) }));
    }
  };
  const copy = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(boardMarkdown(board, cards));
      flash(t("export.copied"));
    } catch {
      flash(t("export.copyFailed"));
    }
  };

  return (
    <span className="sort-menu export-menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)} title={t("export.title")} aria-expanded={open}>
        {done ?? t("export.button")}
      </button>
      {open && (
        <div className="sort-options" role="menu">
          <button role="menuitem" onClick={() => save("md", boardMarkdown(board, cards))}>
            {t("export.md")}
          </button>
          <button role="menuitem" onClick={() => save("md", boardMarkdown(board, cards, { details: true }))}>
            {t("export.mdDetails")}
          </button>
          {/* French spreadsheets split cells on « ; », English ones on « , ». */}
          <button role="menuitem" onClick={() => save("csv", boardCsv(board, cards, getLang() === "fr" ? ";" : ","))}>
            {t("export.csv")}
          </button>
          <button role="menuitem" onClick={copy}>
            {t("export.copy")}
          </button>
        </div>
      )}
    </span>
  );
}
