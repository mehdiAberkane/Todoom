import { useEffect, useRef, useState, type ReactNode } from "react";

const stop = (e: React.PointerEvent) => e.stopPropagation();

/** Text that turns into an input on click. Stops pointer events so it works inside drag handles. */
export function InlineEdit({
  value,
  onSave,
  className = "",
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className={`inline-edit ${className}`}
        onPointerDown={stop}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Cliquer pour renommer"
      >
        {value || placeholder}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
  };

  return (
    <input
      className={`inline-edit-input ${className}`}
      autoFocus
      value={draft}
      onPointerDown={stop}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}

/** Two-step delete: first click arms it, second click within 3s confirms. */
export function DangerButton({
  onConfirm,
  children,
  confirmLabel = "Vraiment ?",
  className = "",
  title,
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      title={title}
      className={`btn-danger ${armed ? "armed" : ""} ${className}`}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function Modal({ onClose, children, className = "" }: { onClose: () => void; children: ReactNode; className?: string }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog">
        {children}
      </div>
    </div>
  );
}
