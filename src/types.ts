export interface Label {
  id: string;
  name: string;
  color: string;
}

/** A priority level of a board; same shape as a label. */
export type Priority = Label;

export interface Column {
  id: string;
  name: string;
  /** Shown as a narrow strip (« Terminé », « Backlog »…); its cards are still there. */
  collapsed?: boolean;
  /** Most cards the column should hold; past it, the column is flagged. */
  limit?: number;
  /** Cards that stayed this many days in the column are archived (« Terminé » after 14 days). */
  archiveAfter?: number;
  /**
   * How the column orders its cards: "manual" (their order), or kept sorted by
   * "priority", "due", "created", "updated". Absent: chosen from the column's
   * name (see columnSort in sorting.ts). Agents take the cards in this order.
   */
  sort?: string;
}

export interface Board {
  id: string;
  name: string;
  /** Prefix of the cards' short ids (SOL in SOL-42); given to each board automatically. */
  key?: string;
  /** Context page: repository, rules, vocabulary, meaning of the columns. Read by agents before taking a ticket. */
  description?: string;
  columns: Column[];
  labels: Label[];
  /** How the cards' git branches are named, e.g. "{type}/{ref}-{slug}"; absent means that one. */
  branchFormat?: string;
  /** The board's repository (https://github.com/owner/repo, https://gitlab.com/group/project): its open pull/merge requests are shown beside the columns. */
  repo?: string;
  /**
   * When a card's pull/merge request is merged (TOD-69): nothing, offer to move the
   * card, or move it; to columnId, else the column named « A verifier ». Absent: offer.
   */
  onMerge?: { action: "none" | "propose" | "move"; columnId?: string };
  /** Priority levels, highest first; absent means the defaults P1, P2, P3. */
  priorities?: Priority[];
  /** A card without a color of its own takes its priority's (P1 red, P2 orange, P3 green); false turns that off. */
  colorByPriority?: boolean;
  /** Fractional position in the sidebar; absent on boards created before reordering existed. */
  order?: number;
  /** Set when the board is in the trash: hidden, restorable, deleted for good after a while. */
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** The card this item became; the item then shows that card's state. */
  cardId?: string;
}

/** How a card relates to another, seen from the card that holds the link. */
export type LinkType = "dependsOn" | "blocks" | "duplicateOf" | "duplicatedBy" | "relatesTo";

export interface CardLink {
  type: LinkType;
  /** Id of the other card, on any board. */
  cardId: string;
}

export type MergeRequestState = "open" | "merged" | "closed";

export interface MergeRequest {
  /** Web address of the merge request (GitLab) or pull request (GitHub). */
  url: string;
  state: MergeRequestState;
}

export interface Card {
  id: string;
  /** Short number on its board: 42 in SOL-42. Absent until given one. */
  number?: number;
  boardId: string;
  columnId: string;
  /** Fractional position inside the column: moving a card rewrites only that card. */
  order: number;
  title: string;
  description: string;
  labels: string[];
  /** Id of one of the board's priority levels, or null. */
  priority: string | null;
  /** YYYY-MM-DD */
  due: string | null;
  checklist: ChecklistItem[];
  /** Links to other cards; each link is also stored, reversed, on the other card. */
  links: CardLink[];
  /** Git branch of the work on this card. */
  branch: string | null;
  mergeRequest: MergeRequest | null;
  /** A color band at the top of the card (one of the palette's), or null/absent for none. */
  color?: string | null;
  /** A routine: when the card reaches a « done » column, the next one is made, due one period later. */
  repeat?: { every: "day" | "week" | "month" } | null;
  /** The next card of a routine waits off the board until this day (YYYY-MM-DD), a few days before it is due. */
  wakeOn?: string | null;
  /** Who is working on the card, or null when nobody is. */
  claimedBy: Claim | null;
  /** Set when the card is archived: it leaves the board but can be restored. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Who wrote a comment or made a change: the computer, and the agent or conversation when it wasn't by hand. */
export interface Author {
  host: string;
  agent?: string;
  conversation?: string;
}

/** Who took a card, and when: also a lock other agents and conversations respect. */
export interface Claim extends Author {
  at: string;
}

/** A file attached to a card; the file itself is boards/<board>/attachments/<card>/<file>. */
export interface Attachment {
  id: string;
  cardId: string;
  /** The name it had when attached. */
  name: string;
  /** Its media type, e.g. image/png. */
  type: string;
  size: number;
  /** The stored file's name, next to this description. */
  file: string;
  createdAt: string;
  author: Author;
}

/** A comment on a card: boards/<board>/comments/<card>/<id>.json. */
export interface CardComment {
  id: string;
  cardId: string;
  createdAt: string;
  author: Author;
  text: string;
}

export type HistoryField =
  | "created"
  | "column"
  | "title"
  | "priority"
  | "labels"
  | "due"
  | "description"
  | "archived"
  | "branch"
  | "mergeRequest"
  | "claimedBy"
  | "board";

/** One change of a card. from/to are names as they were at the time. */
export interface HistoryEvent {
  at: string;
  by: Author;
  field: HistoryField;
  from?: string | null;
  to?: string | null;
}

/** boards/<board>/history/<card>/<writer>.json: the changes made by one computer or tool. */
export interface HistoryFile {
  cardId: string;
  writer: string;
  events: HistoryEvent[];
}

/** What an agent watching a board is doing: boards/<board>/agents/<computer>-agent.json, written by the agent. */
export interface AgentStatus {
  host: string;
  agent: string;
  state: "idle" | "working" | "stopped";
  card: { id: string; title: string } | null;
  /** When the current state began. */
  since: string;
  /** Last time the agent wrote it; a stale one means the agent stopped without saying so. */
  heartbeat: string;
  pollSeconds?: number;
}

/** App-wide preferences, stored once in the data folder so every machine shares them. */
export interface AppSettings {
  /** Background image as a compressed JPEG data URL, or null for the plain dark background. */
  background: string | null;
  /** How much the background is darkened to keep cards readable, from 0 to 0.9. */
  backgroundDim: number;
  /** Interface language; null follows the system's language. */
  language: "fr" | "en" | null;
  /** Columns shown in « My work », by name; absent means the usual ones (En cours, A verifier…). */
  myWorkColumns?: string[];
  /** PR/MR popups (new one, CI failed, merged), for the boards with a repository; absent means all on. */
  reviewNotifications?: { enabled?: boolean; opened?: boolean; ciFailed?: boolean; merged?: boolean; releaseStarted?: boolean; releaseFinished?: boolean };
  /** System notifications; absent means on, for « A verifier » and « Echec », and for due dates. */
  notifications?: { enabled?: boolean; columns?: string[]; due?: boolean };
  /** Template a new board starts from: "simple", "dev" or "copy:<board id>"; absent means "dev". */
  boardTemplate?: string;
  /** Absent means dark; "system" follows the computer's setting. */
  theme?: "dark" | "light" | "system";
  /** Smaller cards: title, short id and colored label marks only. */
  compact?: boolean;
  /** Daily snapshots of the data folder kept on each computer; absent means 14. */
  snapshotKeep?: number;
  /** Board the quick capture adds ideas to; absent means one named « Global », else the first. */
  captureBoard?: string;
  /** Plain text summaries of the boards for the phone (« lecture » folder); absent means on. */
  readingCopy?: boolean;
  /** Also a summary of each past week in « lecture » (TOD-71); absent means on, when readingCopy is. */
  weeklySummary?: boolean;
  /** Ideas dropped from the phone into « boîte de réception » become cards; absent means on. */
  inbox?: boolean;
  updatedAt: string;
}

export interface Presence {
  host: string;
  at: string;
}
