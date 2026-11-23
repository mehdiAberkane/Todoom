import { useState } from "react";
import type { Board, Label } from "../types";
import { LABEL_COLORS, uid } from "../lib/utils";
import { prioritiesOf } from "../lib/priority";
import { DangerButton, Modal } from "./ui";
import { t } from "../lib/i18n";

/** The board's labels and priority levels: rename, recolour, add, delete; levels also move up and down. */
export function LabelManager({ board, onSave, onClose }: { board: Board; onSave: (b: Board) => void; onClose: () => void }) {
  const priorities = prioritiesOf(board);
  // The first change to the default levels writes them into the board.
  const savePriorities = (list: Label[]) => onSave({ ...board, priorities: list });
  const move = (index: number, by: number) => {
    const list = [...priorities];
    const [item] = list.splice(index, 1);
    list.splice(index + by, 0, item);
    savePriorities(list);
  };

  return (
    <Modal onClose={onClose} className="label-modal">
      <div className="modal-head">
        <h3>{t("labels.title", { name: board.name })}</h3>
        <button className="icon-btn" onClick={onClose} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>

      <h4>{t("labels.labels")}</h4>
      <ItemList items={board.labels} onChange={(labels) => onSave({ ...board, labels })} placeholder={t("labels.new")} defaultColor={LABEL_COLORS[5]} />

      <h4>{t("labels.priorities")}</h4>
      <label className="settings-check" title={t("labels.colorByPriorityTitle")}>
        <input type="checkbox" checked={board.colorByPriority !== false} onChange={(e) => onSave({ ...board, colorByPriority: e.target.checked })} />
        {t("labels.colorByPriority")}
      </label>
      <ItemList
        items={priorities}
        onChange={savePriorities}
        placeholder={t("labels.newPriority")}
        defaultColor={LABEL_COLORS[8]}
        extra={(index) => (
          <>
            <button className="icon-btn" disabled={index === 0} onClick={() => move(index, -1)} title={t("labels.up")}>
              ↑
            </button>
            <button className="icon-btn" disabled={index === priorities.length - 1} onClick={() => move(index, 1)} title={t("labels.down")}>
              ↓
            </button>
          </>
        )}
      />
    </Modal>
  );
}

function ItemList({
  items,
  onChange,
  placeholder,
  defaultColor,
  extra,
}: {
  items: Label[];
  onChange: (items: Label[]) => void;
  placeholder: string;
  defaultColor: string;
  extra?: (index: number) => React.ReactNode;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);
  const patch = (id: string, p: Partial<Label>) => onChange(items.map((l) => (l.id === id ? { ...l, ...p } : l)));

  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...items, { id: uid(), name: n, color }]);
    setName("");
  };

  return (
    <>
      <ul className="label-list">
        {items.map((l, index) => (
          <li key={l.id}>
            <ColorPicker value={l.color} onChange={(c) => patch(l.id, { color: c })} />
            <input
              defaultValue={l.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && patch(l.id, { name: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            {extra?.(index)}
            <DangerButton className="icon-btn" onConfirm={() => onChange(items.filter((x) => x.id !== l.id))} confirmLabel={t("common.sureQ")}>
              🗑
            </DangerButton>
          </li>
        ))}
      </ul>
      <div className="label-new">
        <ColorPicker value={color} onChange={setColor} />
        <input placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-primary" onClick={add}>
          {t("common.create")}
        </button>
      </div>
    </>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="color-picker">
      <button className="swatch" style={{ background: value }} onClick={() => setOpen((o) => !o)} title={t("labels.color")} />
      {open && (
        <div className="swatches">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === value ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
