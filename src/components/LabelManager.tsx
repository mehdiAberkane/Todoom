import { useState } from "react";
import type { Board, Label } from "../types";
import { LABEL_COLORS, uid } from "../lib/utils";
import { DangerButton, Modal } from "./ui";

export function LabelManager({ board, onSave, onClose }: { board: Board; onSave: (b: Board) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[5]);

  const update = (labels: Label[]) => onSave({ ...board, labels });
  const patch = (id: string, p: Partial<Label>) => update(board.labels.map((l) => (l.id === id ? { ...l, ...p } : l)));

  const add = () => {
    const n = name.trim();
    if (!n) return;
    update([...board.labels, { id: uid(), name: n, color }]);
    setName("");
  };

  return (
    <Modal onClose={onClose} className="label-modal">
      <div className="modal-head">
        <h3>🏷 Étiquettes de « {board.name} »</h3>
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul className="label-list">
        {board.labels.map((l) => (
          <li key={l.id}>
            <ColorPicker value={l.color} onChange={(c) => patch(l.id, { color: c })} />
            <input
              defaultValue={l.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && patch(l.id, { name: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <DangerButton className="icon-btn" onConfirm={() => update(board.labels.filter((x) => x.id !== l.id))} confirmLabel="Sûr ?">
              🗑
            </DangerButton>
          </li>
        ))}
      </ul>
      <div className="label-new">
        <ColorPicker value={color} onChange={setColor} />
        <input
          placeholder="Nouvelle étiquette"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn-primary" onClick={add}>
          Créer
        </button>
      </div>
    </Modal>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="color-picker">
      <button className="swatch" style={{ background: value }} onClick={() => setOpen((o) => !o)} title="Couleur" />
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
