import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../types";
import { backend, isTauri } from "../lib/backend";
import { attachmentFilePath, formatSize, isImage } from "../lib/attachments";
import { formatDateTime } from "../lib/utils";
import { t } from "../lib/i18n";
import { DangerButton, Modal } from "./ui";

export interface AttachmentProps {
  attachments: Attachment[];
  boardId: string;
  onAdd: (file: File) => Promise<void>;
  onRemove: (attachment: Attachment) => void;
}

// Images already read, by path: reopening a card doesn't read them again.
const loaded = new Map<string, string>();

function useImage(a: Attachment, boardId: string): string | null {
  const path = attachmentFilePath(a, boardId);
  const [src, setSrc] = useState(() => loaded.get(path) ?? null);
  useEffect(() => {
    if (src || !isImage(a)) return;
    let alive = true;
    backend
      .readAttachment(path)
      .then((b64) => {
        const url = `data:${a.type};base64,${b64}`;
        loaded.set(path, url);
        if (alive) setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, a, src]);
  return src;
}

/** The card's files: images shown, the others listed; attach with the button, a paste, or a drop. */
export function AttachmentsSection({ attachments, boardId, onAdd, onRemove, error }: AttachmentProps & { error: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [zoomed, setZoomed] = useState<Attachment | null>(null);

  return (
    <>
      <h4>
        {t("field.attachments")} {attachments.length > 0 && <span className="muted">{attachments.length}</span>}
        <button className="link" onClick={() => input.current?.click()} title={t("attach.addTitle")}>
          {t("attach.add")}
        </button>
      </h4>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          for (const f of e.target.files ?? []) onAdd(f);
          e.target.value = "";
        }}
      />
      {error && <div className="error-box">{error}</div>}
      {attachments.length === 0 ? (
        <div className="attach-empty muted">{t("attach.empty")}</div>
      ) : (
        <ul className="attachments">
          {attachments.map((a) => (
            <AttachmentItem key={a.id} a={a} boardId={boardId} onZoom={() => setZoomed(a)} onRemove={() => onRemove(a)} />
          ))}
        </ul>
      )}
      {zoomed && <Lightbox a={zoomed} boardId={boardId} onClose={() => setZoomed(null)} />}
    </>
  );
}

function AttachmentItem({ a, boardId, onZoom, onRemove }: { a: Attachment; boardId: string; onZoom: () => void; onRemove: () => void }) {
  const src = useImage(a, boardId);
  return (
    <li className="attachment" title={`${a.name} · ${formatSize(a.size)} · ${formatDateTime(a.createdAt)} · ${a.author.host}`}>
      {isImage(a) ? (
        <button className="attach-thumb" onClick={onZoom}>
          {src ? <img src={src} alt={a.name} /> : <span className="muted">…</span>}
        </button>
      ) : (
        <span className="attach-icon">📄</span>
      )}
      <span className="attach-name">{a.name}</span>
      <span className="attach-size muted">{formatSize(a.size)}</span>
      {isTauri && (
        <button className="icon-btn" onClick={() => backend.revealAttachment(attachmentFilePath(a, boardId)).catch(() => {})} title={t("attach.reveal")}>
          📂
        </button>
      )}
      <DangerButton className="icon-btn" onConfirm={onRemove} confirmLabel={t("common.sureQ")} title={t("attach.remove")}>
        🗑
      </DangerButton>
    </li>
  );
}

function Lightbox({ a, boardId, onClose }: { a: Attachment; boardId: string; onClose: () => void }) {
  const src = useImage(a, boardId);
  return (
    <Modal onClose={onClose} className="lightbox">
      <div className="modal-head">
        <h3>{a.name}</h3>
        <button className="icon-btn" onClick={onClose} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>
      {src && <img src={src} alt={a.name} />}
    </Modal>
  );
}

/** The files of a paste or a drop, if it carries some. */
export function filesOf(data: DataTransfer | null): File[] {
  return data ? [...data.files] : [];
}
