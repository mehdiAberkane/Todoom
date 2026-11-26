// Shape checks for the JSON files of the data folder. Scripts, the agent and
// partial Drive syncs can all write files the UI would crash on; a file that
// fails a check is reported instead of shown. Missing fields are fine (they
// get defaults); a field of the wrong type is not.
// The same format is published for scripts in schema/*.schema.json.

type Check = [field: string, ok: (v: unknown) => boolean];

/**
 * The biggest data file read or written (the Rust side, the todoom command and the
 * agent use the same): a file over it is listed as ignored, never read nor
 * overwritten. Real files weigh a few KB (the biggest, settings.json with its
 * background image, 64 KB in November 2026).
 */
export const MAX_DATA_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Longest fields, far above what real cards use (in November 2026: title 119
 * characters, description 4 137, comment 5 336, board context 1 158, 5 checklist
 * items): a field past them comes from a fault, and would slow the whole board.
 */
export const LIMITS = {
  title: 500,
  text: 100_000,
  name: 200,
  branch: 255,
  items: 500,
  itemText: 2_000,
  labels: 100,
  columns: 200,
} as const;

/** A field longer than allowed: its length, the longest of its items' given key, or 0. */
type Limit = [field: string, max: number, size: (v: unknown) => number];
const len = (v: unknown) => (typeof v === "string" || Array.isArray(v) ? v.length : 0);
const longest = (key: string) => (v: unknown) =>
  Array.isArray(v) ? Math.max(0, ...v.map((x) => (isObject(x) && typeof x[key] === "string" ? (x[key] as string).length : 0))) : 0;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown) => typeof v === "string";
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown) => typeof v === "boolean";
/**
 * An id as the app makes them, and the only form used in file paths: the same
 * rule as is_id on the Rust side. An id read from a synced file that isn't one
 * (« ../x ») would lead the CLI or the agent out of the data folder.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);
const optional = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || ok(v);
const nullable = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || v === null || ok(v);
const listOf = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || (Array.isArray(v) && v.every(ok));
const shaped = (checks: Check[]) => (v: unknown) => isObject(v) && checks.every(([f, ok]) => ok(v[f]));

const CARD: Check[] = [
  ["number", optional(isNumber)],
  ["title", optional(isString)],
  ["description", optional(isString)],
  ["columnId", optional(isString)],
  ["order", optional(isNumber)],
  ["labels", listOf(isString)],
  ["priority", nullable(isString)],
  ["due", nullable(isString)],
  ["checklist", listOf(shaped([["id", isString], ["text", isString], ["done", (v) => typeof v === "boolean"], ["cardId", optional(isString)]]))],
  ["links", listOf(shaped([["type", isString], ["cardId", isString]]))],
  ["branch", nullable(isString)],
  ["color", optional(nullable(isString))],
  ["repeat", optional(nullable(shaped([["every", (v) => v === "day" || v === "week" || v === "month"]])))],
  ["wakeOn", nullable((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))],
  ["mergeRequest", nullable(shaped([["url", isString], ["state", (v) => v === "open" || v === "merged" || v === "closed"]]))],
  ["claimedBy", nullable(shaped([["host", isString], ["at", isString], ["agent", optional(isString)], ["conversation", optional(isString)]]))],
  ["archivedAt", nullable(isString)],
  ["createdAt", optional(isString)],
  ["updatedAt", optional(isString)],
];

const CARD_LIMITS: Limit[] = [
  ["title", LIMITS.title, len],
  ["description", LIMITS.text, len],
  ["labels", LIMITS.labels, len],
  ["checklist", LIMITS.items, len],
  ["checklist", LIMITS.itemText, longest("text")],
  ["links", LIMITS.items, len],
  ["branch", LIMITS.branch, len],
];

const BOARD: Check[] = [
  ["name", optional(isString)],
  ["key", optional(isString)],
  ["description", optional(isString)],
  ["branchFormat", optional(isString)],
  ["repo", optional(isString)],
  ["onMerge", optional(shaped([["action", (v) => v === "none" || v === "propose" || v === "move"], ["columnId", optional(isString)]]))],
  ["columns", listOf(shaped([["id", isString], ["name", isString], ["collapsed", optional((v) => typeof v === "boolean")], ["limit", optional(isNumber)], ["archiveAfter", optional(isNumber)], ["sort", optional(isString)]]))],
  ["labels", listOf(shaped([["id", isString], ["name", isString], ["color", isString]]))],
  ["priorities", listOf(shaped([["id", isString], ["name", isString], ["color", isString]]))],
  ["colorByPriority", optional((v) => typeof v === "boolean")],
  ["order", optional(isNumber)],
  ["archivedAt", nullable(isString)],
  ["createdAt", optional(isString)],
  ["updatedAt", optional(isString)],
];

// Base64 only: no quote or parenthesis can break out of the CSS url() it goes into.
const isImageDataUrl = (v: unknown) => isString(v) && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);

const BOARD_LIMITS: Limit[] = [
  ["name", LIMITS.name, len],
  ["description", LIMITS.text, len],
  ["columns", LIMITS.columns, len],
  ["columns", LIMITS.name, longest("name")],
  ["labels", LIMITS.columns, len],
  ["labels", LIMITS.name, longest("name")],
];

const SETTINGS: Check[] = [
  ["background", nullable(isImageDataUrl)],
  ["backgroundDim", optional(isNumber)],
  ["language", nullable((v) => v === "fr" || v === "en")],
  ["myWorkColumns", listOf(isString)],
  ["notifications", optional(shaped([["enabled", optional(isBoolean)], ["columns", listOf(isString)], ["due", optional(isBoolean)]]))],
  ["reviewNotifications", optional(shaped([["enabled", optional(isBoolean)], ["opened", optional(isBoolean)], ["ciFailed", optional(isBoolean)], ["merged", optional(isBoolean)], ["releaseStarted", optional(isBoolean)], ["releaseFinished", optional(isBoolean)]]))],
  ["boardTemplate", optional(isString)],
  ["theme", optional((v) => v === "dark" || v === "light" || v === "system")],
  ["compact", optional(isBoolean)],
  ["snapshotKeep", optional(isNumber)],
  ["captureBoard", optional(isString)],
  ["readingCopy", optional(isBoolean)],
  ["weeklySummary", optional(isBoolean)],
  ["inbox", optional(isBoolean)],
  ["updatedAt", optional(isString)],
];

const AUTHOR = shaped([
  ["host", isString],
  ["agent", optional(isString)],
  ["conversation", optional(isString)],
]);

const COMMENT: Check[] = [
  ["cardId", isId],
  ["createdAt", isString],
  ["text", isString],
  ["author", AUTHOR],
];

const ATTACHMENT: Check[] = [
  ["cardId", isId],
  ["name", isString],
  ["type", isString],
  ["size", isNumber],
  ["file", (v) => isString(v) && /^[\w-]+-[\w.-]+$/.test(v as string) && !(v as string).includes("..")],
  ["createdAt", isString],
  ["author", AUTHOR],
];

const HISTORY: Check[] = [
  ["cardId", isId],
  ["writer", isString],
  ["events", listOf(shaped([["at", isString], ["field", isString], ["by", AUTHOR], ["from", nullable(isString)], ["to", nullable(isString)]]))],
];

const AGENT: Check[] = [
  ["host", isString],
  ["agent", isString],
  ["state", (v) => v === "idle" || v === "working" || v === "stopped"],
  ["card", nullable(shaped([["id", isString], ["title", isString]]))],
  ["since", isString],
  ["heartbeat", isString],
  ["pollSeconds", optional(isNumber)],
];

/** Why a data file can't be used; the interface turns the code into a sentence. */
export interface IssueReason {
  code: "invalid_json" | "not_object" | "missing_id" | "bad_field" | "too_long" | "too_big" | "missing_board" | "unknown_column";
  field?: string;
  /** too_long: the longest allowed (characters or items). */
  max?: number;
  /** too_big: the file's size in bytes. */
  size?: number;
}

function problem(raw: unknown, checks: Check[], needsId: boolean, limits: Limit[] = []): IssueReason | null {
  if (!isObject(raw)) return { code: "not_object" };
  if (needsId && (!isString(raw.id) || !raw.id)) return { code: "missing_id" };
  if (needsId && !isId(raw.id)) return { code: "bad_field", field: "id" };
  const bad = checks.find(([f, ok]) => !ok(raw[f]));
  if (bad) return { code: "bad_field", field: bad[0] };
  const over = limits.find(([f, max, size]) => size(raw[f]) > max);
  return over ? { code: "too_long", field: over[0], max: over[1] } : null;
}

/** Why a card file can't be used, or null when it is fine. */
export const cardProblem = (raw: unknown) => problem(raw, CARD, true, CARD_LIMITS);
export const boardProblem = (raw: unknown) => problem(raw, BOARD, true, BOARD_LIMITS);
export const settingsProblem = (raw: unknown) => problem(raw, SETTINGS, false);
export const commentProblem = (raw: unknown) => problem(raw, COMMENT, true, [["text", LIMITS.text, len]]);
export const historyProblem = (raw: unknown) => problem(raw, HISTORY, false);
export const agentProblem = (raw: unknown) => problem(raw, AGENT, false);
export const attachmentProblem = (raw: unknown) => problem(raw, ATTACHMENT, true);
