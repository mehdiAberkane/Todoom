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
  /** Priority levels, highest first; absent means the defaults P1, P2, P3. */
  priorities?: Priority[];
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
  | "claimedBy";

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
  updatedAt: string;
}

export interface Presence {
  host: string;
  at: string;
}
