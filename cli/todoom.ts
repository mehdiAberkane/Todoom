// `todoom`: the board from a terminal, for scripts and agents. Prints JSON.
// `todoom mcp` serves the same operations to Claude as an MCP server.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { findDataDir, normalize, Store, TodoomError, type CardChanges } from "./store";
import { serveMcp } from "./mcp";
import { prioritiesOf } from "../src/lib/priority";

declare const __TODOOM_VERSION__: string;
export const VERSION = typeof __TODOOM_VERSION__ === "string" ? __TODOOM_VERSION__ : "dev";

const HELP = `todoom ${VERSION} — les tableaux Todoom en ligne de commande (sortie JSON)

  todoom boards [--all]                       tableaux et colonnes (--all : corbeille comprise)
  todoom cards <tableau> [--column <nom>] [--search <texte>] [--archived]
  todoom show <carte>
  todoom create <tableau> <titre> [--column <nom>] [--description <texte>]
                [--label <nom>]... [--priority <nom>] [--due AAAA-MM-JJ]
  todoom update <carte> [--title <texte>] [--description <texte>] [--append <texte>]
                [--label <nom>]... [--unlabel <nom>]... [--priority <nom> | --no-priority]
                [--due AAAA-MM-JJ | --no-due]
  todoom move <carte> <colonne> [--top]
  todoom link <carte> <type> <autre carte>    type : depends-on, blocks, duplicate-of,
                                              duplicated-by, relates-to (écrit sur les deux cartes)
  todoom unlink <carte> <autre carte>
  todoom comment <carte> <texte>
  todoom archive <carte>
  todoom restore <carte>
  todoom mcp                                  serveur MCP (stdio) pour Claude

Tableaux, colonnes et étiquettes se désignent par leur nom : casse et accents
ignorés, un début de nom suffit s'il est unique. Une carte se désigne par son
identifiant (ou un début unique d'au moins 4 caractères).
Un texte égal à « - » est lu sur l'entrée standard.

Options communes : --dir <dossier> (sinon TODOOM_DIR, sinon le dossier choisi
dans l'application), --help, --version.`;

/** "-" means: read the text from stdin, for long descriptions and reports. */
const text = (v: string | undefined) => (v === "-" ? readFileSync(0, "utf8") : v);

function out(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export async function main(argv: string[]): Promise<number> {
  const { values: o, positionals: args } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      all: { type: "boolean" },
      archived: { type: "boolean" },
      column: { type: "string" },
      search: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      append: { type: "string" },
      label: { type: "string", multiple: true },
      unlabel: { type: "string", multiple: true },
      priority: { type: "string" },
      "no-priority": { type: "boolean" },
      due: { type: "string" },
      "no-due": { type: "boolean" },
      top: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = args;
  if (o.version) return (console.log(VERSION), 0);
  if (o.help || !command || command === "help") return (console.log(HELP), 0);

  const need = (n: number, usage: string) => {
    if (rest.length < n) throw new TodoomError(`Usage : todoom ${usage}`);
  };
  const store = () => new Store(findDataDir(o.dir));

  switch (command) {
    case "mcp":
      await serveMcp(findDataDir(o.dir));
      return 0;

    case "boards":
      out(
        store()
          .boards(!!o.all)
          .map((b) => ({
            id: b.id,
            name: b.name,
            trashed: !!b.archivedAt,
            columns: b.columns.map((c) => c.name),
            labels: b.labels.map((l) => l.name),
            priorities: prioritiesOf(b).map((p) => p.name),
          })),
      );
      return 0;

    case "cards": {
      need(1, "cards <tableau> [--column <nom>]");
      const s = store();
      const board = s.board(rest[0]);
      const columnId = o.column ? s.column(board, o.column).id : undefined;
      const q = o.search ? normalize(o.search) : "";
      const cards = s
        .cards(board)
        .filter((c) => !!c.archivedAt === !!o.archived)
        .filter((c) => !columnId || c.columnId === columnId)
        .filter((c) => !q || normalize(`${c.title}\n${c.description}`).includes(q));
      // Board order: column by column, then position in the column.
      const rank = new Map(board.columns.map((c, i) => [c.id, i]));
      cards.sort((a, b) => (rank.get(a.columnId) ?? 99) - (rank.get(b.columnId) ?? 99) || a.order - b.order);
      out(cards.map((c) => {
        const v = s.view(c, board);
        return { id: v.id, column: v.column, title: v.title, priority: v.priority, labels: v.labels, due: v.due, updatedAt: v.updatedAt };
      }));
      return 0;
    }

    case "show": {
      need(1, "show <carte>");
      const s = store();
      const { card, board } = s.card(rest[0]);
      out(s.detail(card, board));
      return 0;
    }

    case "create":
      need(2, "create <tableau> <titre> [--column <nom>]");
      out(
        store().create(rest[0], rest.slice(1).join(" "), {
          column: o.column,
          description: text(o.description),
          labels: o.label,
          priority: o.priority ?? null,
          due: o.due ?? null,
        }),
      );
      return 0;

    case "update": {
      need(1, "update <carte> [--title …] [--description …] [--append …] [--label …] [--due …]");
      const changes: CardChanges = {
        title: o.title,
        description: text(o.description),
        append: text(o.append),
        addLabels: o.label,
        removeLabels: o.unlabel,
        priority: o["no-priority"] ? null : o.priority,
        due: o["no-due"] ? null : o.due,
      };
      if (Object.values(changes).every((v) => v === undefined)) throw new TodoomError("Rien à modifier : voir todoom --help");
      out(store().update(rest[0], changes));
      return 0;
    }

    case "move":
      need(2, "move <carte> <colonne> [--top]");
      out(store().move(rest[0], rest.slice(1).join(" "), o.top ? "top" : "bottom"));
      return 0;

    case "link":
      need(3, "link <carte> <type> <autre carte>");
      out(store().link(rest[0], rest[1], rest[2]));
      return 0;

    case "unlink":
      need(2, "unlink <carte> <autre carte>");
      out(store().unlink(rest[0], rest[1]));
      return 0;

    case "comment":
      need(2, "comment <carte> <texte>");
      out(store().comment(rest[0], text(rest.slice(1).join(" ")) ?? ""));
      return 0;

    case "archive":
      need(1, "archive <carte>");
      out(store().archive(rest[0]));
      return 0;

    case "restore":
      need(1, "restore <carte>");
      out(store().restore(rest[0]));
      return 0;

    default:
      throw new TodoomError(`Commande inconnue : ${command}. Voir todoom --help`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // Known problems are one line for the caller; anything else keeps its stack.
    const message = e instanceof TodoomError || (e as { code?: string })?.code?.startsWith("ERR_PARSE_ARGS") ? (e as Error).message : String((e as Error)?.stack ?? e);
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
    process.exitCode = 1;
  },
);
