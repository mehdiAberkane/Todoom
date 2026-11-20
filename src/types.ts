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

export interface Card {
  id: string;
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
  /** Set when the card is archived: it leaves the board but can be restored. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
