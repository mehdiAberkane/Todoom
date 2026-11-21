import type { Board } from "../types";
import { prioritiesOf } from "../lib/priority";
import { t, tn } from "../lib/i18n";

export interface BulkActions {
  move: (columnId: string) => void;
  addLabel: (labelId: string) => void;
  removeLabel: (labelId: string) => void;
  setPriority: (priorityId: string | null) => void;
  archive: () => void;
  clear: () => void;
}

/** Shown while cards are selected: what can be done to all of them at once. */
export function BulkBar({ board, count, actions }: { board: Board; count: number; actions: BulkActions }) {
  // Each list is an action: picking an entry runs it, and the list goes back to its title.
  const pick = (run: (value: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    e.target.value = "";
    if (value) run(value);
  };

  return (
    <div className="bulk-bar" role="toolbar" aria-label={t("bulk.title")}>
      <strong title={t("bulk.dragHint")}>{tn("bulk.count", count)}</strong>
      <select defaultValue="" onChange={pick(actions.move)} aria-label={t("bulk.move")}>
        <option value="" disabled>
          {t("bulk.move")}
        </option>
        {board.columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        defaultValue=""
        onChange={pick((v) => (v.startsWith("+") ? actions.addLabel(v.slice(1)) : actions.removeLabel(v.slice(1))))}
        aria-label={t("bulk.labels")}
        disabled={!board.labels.length}
      >
        <option value="" disabled>
          {t("bulk.labels")}
        </option>
        <optgroup label={t("bulk.addLabel")}>
          {board.labels.map((l) => (
            <option key={l.id} value={`+${l.id}`}>
              + {l.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("bulk.removeLabel")}>
          {board.labels.map((l) => (
            <option key={l.id} value={`-${l.id}`}>
              − {l.name}
            </option>
          ))}
        </optgroup>
      </select>
      <select defaultValue="" onChange={pick((v) => actions.setPriority(v === "none" ? null : v))} aria-label={t("bulk.priority")}>
        <option value="" disabled>
          {t("bulk.priority")}
        </option>
        {prioritiesOf(board).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="none">{t("describe.none")}</option>
      </select>
      <button className="btn-ghost" onClick={actions.archive} title={t("bulk.archiveTitle")}>
        {t("bulk.archive")}
      </button>
      <button className="icon-btn" onClick={actions.clear} title={t("bulk.clear")}>
        ✕
      </button>
    </div>
  );
}
