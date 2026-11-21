// Files attached to a card: boards/<board>/attachments/<card>/<id>-<name> holds the
// file itself, read only when shown; <id>.json beside it describes it and is
// loaded with the rest of the data.

import type { Attachment } from "../types";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const attachmentsDir = (boardId: string, cardId: string) => `boards/${boardId}/attachments/${cardId}`;
export const attachmentMetaPath = (a: Pick<Attachment, "id" | "cardId">, boardId: string) => `${attachmentsDir(boardId, a.cardId)}/${a.id}.json`;
export const attachmentFilePath = (a: Pick<Attachment, "file" | "cardId">, boardId: string) => `${attachmentsDir(boardId, a.cardId)}/${a.file}`;

/**
 * The stored file name: the id, then the original name reduced to letters,
 * digits, dots, dashes and underscores. Never ".json", which would be read as data.
 */
export function storedName(id: string, original: string): string {
  let name = original
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+/, "")
    .slice(-100);
  if (!name || name === "_") name = "fichier";
  if (name.toLowerCase().endsWith(".json")) name += ".txt";
  return `${id}-${name}`;
}

export const isImage = (a: Pick<Attachment, "type">) => /^image\/(png|jpeg|gif|webp)$/.test(a.type);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** A file's content as base64, as the backend takes it. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
