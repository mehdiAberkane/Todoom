// The inbox: a folder of the data folder where the phone drops ideas, with
// « Share › Save to Drive ». A file there (a page shared from a browser is a
// file named after the page, without extension, holding its address) becomes
// a card on the quick capture board, then the file goes away.
//
// Two computers may see the same file: the card's id comes from the file's
// name and content, so both write the same card; the file is removed only once
// the card is read back from the folder, so an idea is never lost on the way.

export const INBOX_DIR = "boîte de réception";
/** Bigger than a note or a link: left in the folder and reported. */
export const INBOX_MAX_BYTES = 64 * 1024;

export interface InboxFile {
  name: string;
  size: number;
}

/** Files of the folder that aren't ideas: the system's, and half-downloaded ones. */
export function isInboxCandidate(name: string): boolean {
  const lower = name.toLowerCase();
  return !!name && !name.startsWith(".") && !name.startsWith("~") && lower !== "desktop.ini" && !/\.(tmp|part|crdownload)$/.test(lower);
}

const URL_ONLY = /^https?:\/\/\S+$/i;

/** The name without a text extension; « singha - Brave Search » stays as it is. */
const baseName = (name: string) => name.replace(/\.(txt|md|markdown|text)$/i, "").trim();

/**
 * The card an inbox file makes. A shared page (its address alone): titled after
 * the file, the address in the description. A note: its first line is the
 * title, the rest the description. Nothing written: the file's name.
 */
export function inboxCard(name: string, content: string): { title: string; description: string } {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const fallback = baseName(name) || name;
  if (!text) return { title: fallback, description: "" };
  if (URL_ONLY.test(text)) return { title: fallback, description: text };
  const lines = text.split("\n");
  const first = lines[0].replace(/^#+\s*/, "").trim();
  const rest = lines.slice(1).join("\n").trim();
  // A one-line note longer than a title: the start as title, all of it kept below.
  if (first.length > 120) return { title: `${first.slice(0, 117).trimEnd()}…`, description: text };
  return { title: first || fallback, description: rest };
}

/** FNV-1a on the text, 32 bits, from a given start: two of them make a short id unlikely to clash. */
function fnv(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The id of the card a file makes: the same on every computer, from its name and content. */
export function inboxCardId(name: string, content: string): string {
  const key = `${name}\u0000${content}`;
  return `in${fnv(key, 0x811c9dc5).toString(36)}${fnv(key, 0x050c5d1f).toString(36)}`;
}

/** Why a file can't become a card: too big, or not text. */
export function inboxProblem(file: InboxFile, content?: string): "tooBig" | "notText" | null {
  if (file.size > INBOX_MAX_BYTES) return "tooBig";
  // A NUL or a replacement mark (bytes that weren't UTF-8): not text.
  // eslint-disable-next-line no-control-regex
  if (content !== undefined && /\u0000|\uFFFD/.test(content)) return "notText";
  return null;
}
