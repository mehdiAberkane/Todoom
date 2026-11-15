// Shape checks for the JSON files of the data folder. Scripts, the agent and
// partial Drive syncs can all write files the UI would crash on; a file that
// fails a check is reported instead of shown. Missing fields are fine (they
// get defaults); a field of the wrong type is not.
// The same format is published for scripts in schema/*.schema.json.

type Check = [field: string, ok: (v: unknown) => boolean];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown) => typeof v === "string";
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const optional = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || ok(v);
const nullable = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || v === null || ok(v);
const listOf = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || (Array.isArray(v) && v.every(ok));
const shaped = (checks: Check[]) => (v: unknown) => isObject(v) && checks.every(([f, ok]) => ok(v[f]));

const CARD: Check[] = [
  ["title", optional(isString)],
  ["description", optional(isString)],
  ["columnId", optional(isString)],
  ["order", optional(isNumber)],
  ["labels", listOf(isString)],
  ["due", nullable(isString)],
  ["checklist", listOf(shaped([["id", isString], ["text", isString], ["done", (v) => typeof v === "boolean"]]))],
  ["archivedAt", nullable(isString)],
  ["createdAt", optional(isString)],
  ["updatedAt", optional(isString)],
];

const BOARD: Check[] = [
  ["name", optional(isString)],
  ["columns", listOf(shaped([["id", isString], ["name", isString]]))],
  ["labels", listOf(shaped([["id", isString], ["name", isString], ["color", isString]]))],
  ["order", optional(isNumber)],
  ["createdAt", optional(isString)],
  ["updatedAt", optional(isString)],
];

const SETTINGS: Check[] = [
  ["background", nullable(isString)],
  ["backgroundDim", optional(isNumber)],
  ["updatedAt", optional(isString)],
];

function problem(raw: unknown, checks: Check[], needsId: boolean): string | null {
  if (!isObject(raw)) return "le contenu n'est pas un objet JSON";
  if (needsId && (!isString(raw.id) || !raw.id)) return "champ « id » manquant";
  const bad = checks.find(([f, ok]) => !ok(raw[f]));
  return bad ? `champ « ${bad[0]} » de type inattendu` : null;
}

/** Why a card file can't be used, or null when it is fine. */
export const cardProblem = (raw: unknown) => problem(raw, CARD, true);
export const boardProblem = (raw: unknown) => problem(raw, BOARD, true);
export const settingsProblem = (raw: unknown) => problem(raw, SETTINGS, false);
