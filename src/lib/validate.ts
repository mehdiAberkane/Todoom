// Shape checks for the JSON files of the data folder. Scripts, the agent and
// partial Drive syncs can all write files the UI would crash on; a file that
// fails a check is reported instead of shown. Missing fields are fine (they
// get defaults); a field of the wrong type is not.
// The same format is published for scripts in schema/*.schema.json.

type Check = [field: string, ok: (v: unknown) => boolean];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown) => typeof v === "string";
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown) => typeof v === "boolean";
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
  ["mergeRequest", nullable(shaped([["url", isString], ["state", (v) => v === "open" || v === "merged" || v === "closed"]]))],
  ["claimedBy", nullable(shaped([["host", isString], ["at", isString], ["agent", optional(isString)], ["conversation", optional(isString)]]))],
  ["archivedAt", nullable(isString)],
  ["createdAt", optional(isString)],
  ["updatedAt", optional(isString)],
];

const BOARD: Check[] = [
  ["name", optional(isString)],
  ["key", optional(isString)],
  ["description", optional(isString)],
  ["branchFormat", optional(isString)],
  ["columns", listOf(shaped([["id", isString], ["name", isString], ["collapsed", optional((v) => typeof v === "boolean")], ["limit", optional(isNumber)], ["archiveAfter", optional(isNumber)]]))],
  ["labels", listOf(shaped([["id", isString], ["name", isString], ["color", isString]]))],
  ["priorities", listOf(shaped([["id", isString], ["name", isString], ["color", isString]]))],
  ["order", optional(isNumber)],
  ["archivedAt", nullable(isString)],
  ["createdAt", optional(isString)],
  ["updatedAt", optional(isString)],
];

// Base64 only: no quote or parenthesis can break out of the CSS url() it goes into.
const isImageDataUrl = (v: unknown) => isString(v) && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);

const SETTINGS: Check[] = [
  ["background", nullable(isImageDataUrl)],
  ["backgroundDim", optional(isNumber)],
  ["language", nullable((v) => v === "fr" || v === "en")],
  ["myWorkColumns", listOf(isString)],
  ["notifications", optional(shaped([["enabled", optional(isBoolean)], ["columns", listOf(isString)], ["due", optional(isBoolean)]]))],
  ["boardTemplate", optional(isString)],
  ["theme", optional((v) => v === "dark" || v === "light" || v === "system")],
  ["compact", optional(isBoolean)],
  ["updatedAt", optional(isString)],
];

const AUTHOR = shaped([
  ["host", isString],
  ["agent", optional(isString)],
  ["conversation", optional(isString)],
]);

const COMMENT: Check[] = [
  ["cardId", isString],
  ["createdAt", isString],
  ["text", isString],
  ["author", AUTHOR],
];

const ATTACHMENT: Check[] = [
  ["cardId", isString],
  ["name", isString],
  ["type", isString],
  ["size", isNumber],
  ["file", (v) => isString(v) && /^[\w-]+-[\w.-]+$/.test(v as string) && !(v as string).includes("..")],
  ["createdAt", isString],
  ["author", AUTHOR],
];

const HISTORY: Check[] = [
  ["cardId", isString],
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
  code: "invalid_json" | "not_object" | "missing_id" | "bad_field" | "missing_board" | "unknown_column";
  field?: string;
}

function problem(raw: unknown, checks: Check[], needsId: boolean): IssueReason | null {
  if (!isObject(raw)) return { code: "not_object" };
  if (needsId && (!isString(raw.id) || !raw.id)) return { code: "missing_id" };
  const bad = checks.find(([f, ok]) => !ok(raw[f]));
  return bad ? { code: "bad_field", field: bad[0] } : null;
}

/** Why a card file can't be used, or null when it is fine. */
export const cardProblem = (raw: unknown) => problem(raw, CARD, true);
export const boardProblem = (raw: unknown) => problem(raw, BOARD, true);
export const settingsProblem = (raw: unknown) => problem(raw, SETTINGS, false);
export const commentProblem = (raw: unknown) => problem(raw, COMMENT, true);
export const historyProblem = (raw: unknown) => problem(raw, HISTORY, false);
export const agentProblem = (raw: unknown) => problem(raw, AGENT, false);
export const attachmentProblem = (raw: unknown) => problem(raw, ATTACHMENT, true);
