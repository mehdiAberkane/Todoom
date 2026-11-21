// Templates: what a new board starts with, and the outline a new card can start from.

import type { Board, Card, Column, Label, Priority } from "../types";
import { t } from "./i18n";
import { uid } from "./ids";
import { LABEL_COLORS } from "./utils";

/** "simple", "dev", or "copy:<board id>" to start from an existing board's set-up. */
export type BoardTemplate = string;

export interface BoardSetup {
  columns: Omit<Column, "id">[];
  labels: Omit<Label, "id">[];
  priorities?: Omit<Priority, "id">[];
  description?: string;
}

/** The set-up of a new board, in the language in use. Ids are given when the board is made. */
export function boardSetup(template: BoardTemplate, boards: Board[]): BoardSetup {
  if (template.startsWith("copy:")) {
    const source = boards.find((b) => b.id === template.slice(5));
    if (source) {
      // Columns (with their collapsed flag and limit), labels, priorities and context; not the cards.
      return {
        columns: source.columns.map(({ id: _id, ...c }) => c),
        labels: source.labels.map(({ id: _id, ...l }) => l),
        ...(source.priorities ? { priorities: source.priorities.map(({ id: _id, ...p }) => p) } : {}),
        ...(source.description ? { description: source.description } : {}),
      };
    }
  }
  if (template === "dev") {
    return {
      columns: [
        { name: t("tpl.todo") },
        { name: t("tpl.doing") },
        { name: t("tpl.review") },
        { name: t("tpl.done"), collapsed: true },
        { name: t("tpl.backlog"), collapsed: true },
      ],
      labels: [
        { name: t("tpl.bug"), color: LABEL_COLORS[0] },
        { name: t("tpl.feature"), color: LABEL_COLORS[5] },
        { name: t("tpl.security"), color: LABEL_COLORS[6] },
        { name: t("tpl.quality"), color: LABEL_COLORS[4] },
        { name: t("tpl.performance"), color: LABEL_COLORS[1] },
      ],
      description: t("tpl.devContext"),
    };
  }
  return {
    columns: [{ name: t("default.todo") }, { name: t("default.doing") }, { name: t("default.done") }],
    labels: [
      { name: t("default.urgent"), color: LABEL_COLORS[0] },
      { name: t("default.bug"), color: LABEL_COLORS[1] },
      { name: t("default.idea"), color: LABEL_COLORS[6] },
      { name: t("default.personal"), color: LABEL_COLORS[3] },
    ],
  };
}

/** The new board's own fields from a set-up, every column, label and level with a fresh id. */
export function fromSetup(setup: BoardSetup): Pick<Board, "columns" | "labels" | "priorities" | "description"> {
  return {
    columns: setup.columns.map((c) => ({ ...c, id: uid() })),
    labels: setup.labels.map((l) => ({ ...l, id: uid() })),
    ...(setup.priorities ? { priorities: setup.priorities.map((p) => ({ ...p, id: uid() })) } : {}),
    ...(setup.description ? { description: setup.description } : {}),
  };
}

export type CardTemplate = "bug" | "feature" | "audit";
export const CARD_TEMPLATES: CardTemplate[] = ["bug", "feature", "audit"];

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
/** Label names a card template looks for on the board, any language. */
const TEMPLATE_LABELS: Record<CardTemplate, string[]> = {
  bug: ["bug"],
  feature: ["fonctionnalite", "feature"],
  audit: ["audit", "securite", "security"],
};

/**
 * A card from a template: its description outline, and the board's matching
 * label (the first found) added. Its title and the rest are kept.
 */
export function applyTemplate(card: Card, template: CardTemplate, board: Board): Card {
  const wanted = TEMPLATE_LABELS[template];
  const label = board.labels.find((l) => wanted.includes(plain(l.name)));
  return {
    ...card,
    description: t(`tpl.card.${template}`),
    labels: label && !card.labels.includes(label.id) ? [...card.labels, label.id] : card.labels,
  };
}
