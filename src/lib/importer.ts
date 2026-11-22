// Boards from elsewhere: a Trello board exported as JSON, or GitLab issues
// (the CSV of « Export as CSV », or the JSON of the issues API). The result
// is a plain description, turned into a new board by the store.
import { LABEL_COLORS } from "./utils";

export interface ImportedCard {
  title: string;
  description: string;
  column: string;
  labels: string[];
  /** YYYY-MM-DD. */
  due: string | null;
  checklist: { text: string; done: boolean }[];
  archived: boolean;
  comments: { author: string; date: string; text: string }[];
}

export interface ImportedBoard {
  name: string;
  source: "trello" | "gitlab";
  columns: string[];
  labels: { name: string; color: string }[];
  cards: ImportedCard[];
}

export class ImportError extends Error {}

const TRELLO_COLORS: Record<string, string> = {
  green: "#3ddc84",
  yellow: "#ffd23f",
  orange: "#ff9f1c",
  red: "#ff4d2e",
  purple: "#8338ec",
  blue: "#3a86ff",
  sky: "#2ec4b6",
  lime: "#9be564",
  pink: "#ff5fa2",
  black: "#8d99ae",
};

const day = (date: unknown) => (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

interface TrelloBoard {
  name?: string;
  lists?: { id: string; name: string; closed?: boolean; pos?: number }[];
  cards?: { id: string; name?: string; desc?: string; idList: string; idLabels?: string[]; due?: string | null; closed?: boolean; pos?: number }[];
  labels?: { id: string; name?: string; color?: string | null }[];
  checklists?: { idCard: string; pos?: number; checkItems?: { name?: string; state?: string; pos?: number }[] }[];
  actions?: { type?: string; date?: string; data?: { card?: { id?: string }; text?: string }; memberCreator?: { fullName?: string; username?: string } }[];
}

/** A Trello board, from « Menu › Print, export and share › Export as JSON ». */
export function fromTrello(raw: unknown): ImportedBoard {
  const b = raw as TrelloBoard;
  if (!b || !Array.isArray(b.lists) || !Array.isArray(b.cards)) throw new ImportError("trello");
  const byPos = <T extends { pos?: number }>(a: T, c: T) => (a.pos ?? 0) - (c.pos ?? 0);
  const lists = [...b.lists].filter((l) => !l.closed).sort(byPos);
  const listName = new Map(b.lists.map((l) => [l.id, l.name]));
  // A label without a name in Trello is only a color: named after it.
  const labels = (b.labels ?? []).map((l, i) => ({
    id: l.id,
    name: str(l.name).trim() || str(l.color) || `label ${i + 1}`,
    color: (Object.prototype.hasOwnProperty.call(TRELLO_COLORS, str(l.color)) ? TRELLO_COLORS[str(l.color)] : undefined) ?? LABEL_COLORS[i % LABEL_COLORS.length],
  }));
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const columns = lists.map((l) => l.name);
  const cards = [...b.cards].sort(byPos).map((c): ImportedCard => {
    // A card of an archived list goes to the first column, archived.
    const column = lists.some((l) => l.id === c.idList) ? listName.get(c.idList)! : columns[0];
    const checklist = (b.checklists ?? [])
      .filter((cl) => cl.idCard === c.id)
      .sort(byPos)
      .flatMap((cl) => [...(cl.checkItems ?? [])].sort(byPos).map((i) => ({ text: str(i.name), done: i.state === "complete" })));
    const comments = (b.actions ?? [])
      .filter((a) => a.type === "commentCard" && a.data?.card?.id === c.id && a.data?.text)
      .map((a) => ({ author: a.memberCreator?.fullName || a.memberCreator?.username || "Trello", date: str(a.date), text: str(a.data!.text) }))
      .sort((x, y) => x.date.localeCompare(y.date));
    return {
      title: str(c.name).trim() || "…",
      description: str(c.desc),
      column,
      labels: (c.idLabels ?? []).map((id) => labelName.get(id)).filter((n): n is string => !!n),
      due: day(c.due),
      checklist,
      archived: !!c.closed || !lists.some((l) => l.id === c.idList),
      comments,
    };
  });
  return { name: str(b.name).trim() || "Trello", source: "trello", columns: columns.length ? columns : ["…"], labels: labels.map(({ name, color }) => ({ name, color })), cards };
}

/** Splits CSV text into rows: quoted cells may hold separators, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

interface GitlabIssue {
  title: string;
  description: string;
  state: string;
  labels: string[];
  due: string | null;
  url: string;
  ref: string;
  assignee: string;
}

const DOING_LABELS = ["doing", "in progress", "en cours", "wip", "workflow::in progress", "workflow::doing"];
const REVIEW_LABELS = ["review", "to review", "a verifier", "à vérifier", "workflow::review", "workflow::in review"];

/** GitLab issues into the development columns: open ones by their workflow label, closed ones done. */
function gitlabBoard(name: string, issues: GitlabIssue[]): ImportedBoard {
  const columns = ["À faire", "En cours", "A verifier", "Terminé"];
  const has = (issue: GitlabIssue, wanted: string[]) => issue.labels.some((l) => wanted.includes(l.toLowerCase()));
  const workflow = [...DOING_LABELS, ...REVIEW_LABELS];
  const labelNames = [...new Set(issues.flatMap((i) => i.labels.filter((l) => !workflow.includes(l.toLowerCase()))))];
  return {
    name,
    source: "gitlab",
    columns,
    labels: labelNames.map((n, i) => ({ name: n, color: LABEL_COLORS[i % LABEL_COLORS.length] })),
    cards: issues.map((issue) => ({
      title: issue.title.trim() || issue.ref || "…",
      description: [issue.description.trim(), issue.url ? `—\n${issue.ref ? `${issue.ref} : ` : ""}${issue.url}` : ""].filter(Boolean).join("\n\n"),
      column: issue.state === "closed" ? "Terminé" : has(issue, REVIEW_LABELS) ? "A verifier" : has(issue, DOING_LABELS) ? "En cours" : "À faire",
      labels: issue.labels.filter((l) => !workflow.includes(l.toLowerCase())),
      due: issue.due,
      checklist: [],
      archived: false,
      comments: [],
    })),
  };
}

/** GitLab issues: the CSV of « Issues › Export as CSV », or the JSON of /projects/:id/issues. */
export function fromGitlab(text: string, name = "GitLab"): ImportedBoard {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const list = JSON.parse(trimmed) as Record<string, unknown>[];
    if (!list.every((i) => i && typeof i.title === "string" && "state" in i)) throw new ImportError("gitlab");
    const issues = list.map((i) => ({
      title: str(i.title),
      description: str(i.description),
      state: str(i.state),
      labels: Array.isArray(i.labels) ? i.labels.map((l) => (typeof l === "string" ? l : str((l as { name?: string }).name))).filter(Boolean) : [],
      due: day(i.due_date),
      url: str(i.web_url),
      ref: typeof i.iid === "number" ? `#${i.iid}` : "",
      assignee: str((i.assignee as { name?: string } | null)?.name),
    }));
    return gitlabBoard(name, issues);
  }
  const [header, ...rows] = parseCsv(trimmed);
  const col = (n: string) => header?.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase()) ?? -1;
  const [title, desc, state, labels, due, url, iid, assignee] = ["Title", "Description", "State", "Labels", "Due Date", "URL", "Issue ID", "Assignee"].map(col);
  if (title < 0 || state < 0) throw new ImportError("gitlab");
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
  const issues = rows.map((r) => ({
    title: at(r, title),
    description: at(r, desc),
    state: at(r, state).toLowerCase() === "closed" ? "closed" : "opened",
    labels: at(r, labels).split(",").map((l) => l.trim()).filter(Boolean),
    due: day(at(r, due)),
    url: at(r, url),
    ref: at(r, iid) ? `#${at(r, iid)}` : "",
    assignee: at(r, assignee),
  }));
  return gitlabBoard(name, issues);
}

/** Recognizes the file: a Trello board (JSON object), GitLab issues (JSON list, or CSV). */
export function importFile(fileName: string, text: string): ImportedBoard {
  const base = fileName.replace(/\.[^.]+$/, "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new ImportError("json");
    }
    return fromTrello(raw);
  }
  if (trimmed.startsWith("[")) {
    try {
      return fromGitlab(trimmed, base);
    } catch (e) {
      throw e instanceof ImportError ? e : new ImportError("json");
    }
  }
  return fromGitlab(trimmed, base);
}
