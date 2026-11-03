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
  createdAt: string;
  updatedAt: string;
}

export interface Presence {
  host: string;
  at: string;
}
