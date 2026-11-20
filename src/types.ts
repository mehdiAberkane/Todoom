export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Column {
  id: string;
  name: string;
}

export interface Board {
  id: string;
  name: string;
  columns: Column[];
  labels: Label[];
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

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  /** Fractional position inside the column: moving a card rewrites only that card. */
  order: number;
  title: string;
  description: string;
  labels: string[];
  /** YYYY-MM-DD */
  due: string | null;
  checklist: ChecklistItem[];
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
  updatedAt: string;
}

export interface Presence {
  host: string;
  at: string;
}
