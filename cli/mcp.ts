// `todoom mcp`: the same operations as the command, as MCP tools over stdio.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { normalize, Store, TodoomError } from "./store";
import { prioritiesOf } from "../src/lib/priority";

declare const __TODOOM_VERSION__: string;
const VERSION = typeof __TODOOM_VERSION__ === "string" ? __TODOOM_VERSION__ : "dev";

const NAMES =
  "Boards, columns and labels are given by name (case and accents ignored; a unique start of the name is enough). " +
  "A card is given by its id.";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs an operation and returns its JSON, or the error as a tool error the model can read. */
function run(op: () => unknown): Result {
  try {
    return { content: [{ type: "text", text: JSON.stringify(op(), null, 2) }] };
  } catch (e) {
    const message = e instanceof TodoomError ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function createServer(dir: string): McpServer {
  const store = new Store(dir);
  const server = new McpServer({ name: "todoom", version: VERSION });
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "Todoom boards with their columns (in board order), labels and priority levels (highest first).",
      inputSchema: { includeTrashed: z.boolean().optional().describe("Also list boards in the trash") },
      annotations: readOnly,
    },
    ({ includeTrashed }) =>
      run(() =>
        store
          .boards(!!includeTrashed)
          .map((b) => ({
            id: b.id,
            name: b.name,
            trashed: !!b.archivedAt,
            columns: b.columns.map((c) => c.name),
            labels: b.labels.map((l) => l.name),
            priorities: prioritiesOf(b).map((p) => p.name),
          })),
      ),
  );

  server.registerTool(
    "list_cards",
    {
      title: "List cards",
      description: `Cards of a board, column by column, without their descriptions (use get_card). ${NAMES}`,
      inputSchema: {
        board: z.string().describe("Board name"),
        column: z.string().optional().describe("Only this column"),
        search: z.string().optional().describe("Only cards whose title or description contains this text"),
        archived: z.boolean().optional().describe("List archived cards instead of the ones on the board"),
      },
      annotations: readOnly,
    },
    ({ board: boardName, column, search, archived }) =>
      run(() => {
        const board = store.board(boardName);
        const columnId = column ? store.column(board, column).id : undefined;
        const q = search ? normalize(search) : "";
        const rank = new Map(board.columns.map((c, i) => [c.id, i]));
        return store
          .cards(board)
          .filter((c) => !!c.archivedAt === !!archived)
          .filter((c) => !columnId || c.columnId === columnId)
          .filter((c) => !q || normalize(`${c.title}\n${c.description}`).includes(q))
          .sort((a, b) => (rank.get(a.columnId) ?? 99) - (rank.get(b.columnId) ?? 99) || a.order - b.order)
          .map((c) => {
            const v = store.view(c, board);
            return { id: v.id, column: v.column, title: v.title, priority: v.priority, labels: v.labels, due: v.due, updatedAt: v.updatedAt };
          });
      }),
  );

  server.registerTool(
    "get_card",
    {
      title: "Get a card",
      description: "A card with its description, priority, labels, due date, checklist and links (with the linked cards' titles, boards, columns and whether they are finished).",
      inputSchema: { card: z.string().describe("Card id") },
      annotations: readOnly,
    },
    ({ card }) =>
      run(() => {
        const found = store.card(card);
        return store.detail(found.card, found.board);
      }),
  );

  server.registerTool(
    "create_card",
    {
      title: "Create a card",
      description: `Creates a card at the bottom of a column (the first column by default). ${NAMES}`,
      inputSchema: {
        board: z.string().describe("Board name"),
        title: z.string().min(1),
        column: z.string().optional().describe("Column name; the first column if left out"),
        description: z.string().optional(),
        labels: z.array(z.string()).optional().describe("Label names; they must exist on the board"),
        priority: z.string().optional().describe("Priority level name, e.g. P1; see list_boards"),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date, YYYY-MM-DD"),
      },
      annotations: writes,
    },
    ({ board, title, column, description, labels, priority, due }) =>
      run(() => store.create(board, title, { column, description, labels, priority, due })),
  );

  server.registerTool(
    "update_card",
    {
      title: "Update a card",
      description:
        "Changes the fields given and keeps the others. To add a report or a note, prefer add_comment over rewriting the description.",
      inputSchema: {
        card: z.string().describe("Card id"),
        title: z.string().min(1).optional(),
        description: z.string().optional().describe("Replaces the whole description"),
        append: z.string().optional().describe("Added at the end of the description, after a blank line"),
        addLabels: z.array(z.string()).optional().describe("Label names to add"),
        removeLabels: z.array(z.string()).optional().describe("Label names to remove"),
        priority: z.string().nullable().optional().describe("Priority level name, or null to remove it"),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("YYYY-MM-DD, or null to remove the due date"),
      },
      annotations: writes,
    },
    ({ card, ...changes }) => run(() => store.update(card, changes)),
  );

  server.registerTool(
    "move_card",
    {
      title: "Move a card",
      description: `Moves a card to a column of its board, at the bottom (or the top). ${NAMES}`,
      inputSchema: {
        card: z.string().describe("Card id"),
        column: z.string().describe("Column name, e.g. « En cours »"),
        position: z.enum(["top", "bottom"]).optional(),
      },
      annotations: { ...writes, idempotentHint: true },
    },
    ({ card, column, position }) => run(() => store.move(card, column, position ?? "bottom")),
  );

  server.registerTool(
    "link_cards",
    {
      title: "Link two cards",
      description:
        "Links two cards, possibly on different boards. The link is written on both cards, each in its own direction: " +
        "card dependsOn other also writes other blocks card. A card with an unfinished dependsOn is shown as blocked. " +
        "Replaces any other link between the same two cards.",
      inputSchema: {
        card: z.string().describe("Card id"),
        type: z.enum(["dependsOn", "blocks", "duplicateOf", "duplicatedBy", "relatesTo"]),
        other: z.string().describe("Id of the other card"),
      },
      annotations: { ...writes, idempotentHint: true },
    },
    ({ card, type, other }) => run(() => store.link(card, type, other)),
  );

  server.registerTool(
    "unlink_cards",
    {
      title: "Unlink two cards",
      description: "Removes the link between two cards, from both.",
      inputSchema: { card: z.string().describe("Card id"), other: z.string().describe("Id of the other card") },
      annotations: { ...writes, idempotentHint: true },
    },
    ({ card, other }) => run(() => store.unlink(card, other)),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Comment on a card",
      description: "Adds a dated note signed with this computer's name at the end of the card's description: reports, findings, questions.",
      inputSchema: { card: z.string().describe("Card id"), text: z.string().min(1) },
      annotations: writes,
    },
    ({ card, text }) => run(() => store.comment(card, text)),
  );

  server.registerTool(
    "archive_card",
    {
      title: "Archive a card",
      description: "Takes a card off the board; it stays in the board's archive and can be restored.",
      inputSchema: { card: z.string().describe("Card id") },
      annotations: { ...writes, idempotentHint: true },
    },
    ({ card }) => run(() => store.archive(card)),
  );

  server.registerTool(
    "restore_card",
    {
      title: "Restore a card",
      description: "Puts an archived card back at the bottom of its column.",
      inputSchema: { card: z.string().describe("Card id") },
      annotations: { ...writes, idempotentHint: true },
    },
    ({ card }) => run(() => store.restore(card)),
  );

  return server;
}

export async function serveMcp(dir: string) {
  await createServer(dir).connect(new StdioServerTransport());
}
