// `todoom`: the board from a terminal, for scripts and agents. Prints JSON.
// `todoom mcp` serves the same operations to Claude as an MCP server.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { findDataDir, identity, normalize, Store, TodoomError, type CardChanges } from "./store";
import { serveMcp } from "./mcp";
import { prioritiesOf } from "../src/lib/priority";
import { claimLabel } from "../src/lib/claim";

declare const __TODOOM_VERSION__: string;
export const VERSION = typeof __TODOOM_VERSION__ === "string" ? __TODOOM_VERSION__ : "dev";

const HELP = `todoom ${VERSION} — les tableaux Todoom en ligne de commande (sortie JSON)

  todoom boards [--all]                       tableaux et colonnes (--all : corbeille comprise)
  todoom board <tableau> [--description <texte>]
                                              un tableau et sa page de contexte (à lire avant
                                              de prendre un ticket) ; --description la remplace
  todoom cards <tableau> [--column <nom>] [--search <texte>] [--archived]
  todoom show <carte>
  todoom create <tableau> <titre> [--column <nom>] [--description <texte>]
                [--label <nom>]... [--priority <nom>] [--due AAAA-MM-JJ]
  todoom update <carte> [--title <texte>] [--description <texte>] [--append <texte>]
                [--label <nom>]... [--unlabel <nom>]... [--priority <nom> | --no-priority]
                [--due AAAA-MM-JJ | --no-due] [--branch <nom> | --no-branch]
                [--mr <adresse>] [--mr-state open|merged|closed] [--no-mr]
  todoom move <carte> <colonne> [--top] [--board <tableau>]
                                              --board : vers un autre tableau (étiquettes par nom)
  todoom link <carte> <type> <autre carte>    type : depends-on, blocks, duplicate-of,
                                              duplicated-by, relates-to (écrit sur les deux cartes)
  todoom unlink <carte> <autre carte>
  todoom claim <carte> [--move <colonne>] [--conversation <nom>] [--force]
                                              prendre le ticket (refusé s'il est pris par un autre)
  todoom release <carte> [--force]            le libérer
  todoom branch <carte> [--save]              nom de la branche du ticket (texte seul), celui
                                              de la carte ou celui proposé par le format du
                                              tableau ; --save l'enregistre sur la carte.
                                              Ex. : git switch -c $(todoom branch SOL-42 --save)
  todoom comment <carte> <texte>              commentaire daté et signé (PC, TODOOM_AGENT)
  todoom archive <carte>
  todoom restore <carte>
  todoom mcp                                  serveur MCP (stdio) pour Claude

Tableaux, colonnes et étiquettes se désignent par leur nom : casse et accents
ignorés, un début de nom suffit s'il est unique. Une carte se désigne par son
identifiant court (SOL-42), son identifiant, ou un début unique d'au moins
4 caractères de celui-ci.
Un texte égal à « - » est lu sur l'entrée standard.

Options communes : --dir <dossier> (sinon TODOOM_DIR, sinon le dossier choisi
dans l'application), --as <agent> (signe commentaires et historique ; sinon
TODOOM_AGENT), --help, --version.`;

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
      as: { type: "string" },
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
      branch: { type: "string" },
      "no-branch": { type: "boolean" },
      mr: { type: "string" },
      "mr-state": { type: "string" },
      "no-mr": { type: "boolean" },
      move: { type: "string" },
      board: { type: "string" },
      conversation: { type: "string" },
      force: { type: "boolean" },
      due: { type: "string" },
      "no-due": { type: "boolean" },
      top: { type: "boolean" },
      save: { type: "boolean" },
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
  const store = () => new Store(findDataDir(o.dir), identity("cli", o.as));

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
            key: b.key ?? null,
            trashed: !!b.archivedAt,
            columns: b.columns.map((c) => c.name),
            labels: b.labels.map((l) => l.name),
            priorities: prioritiesOf(b).map((p) => p.name),
          })),
      );
      return 0;

    case "board":
      need(1, "board <tableau> [--description <texte>]");
      out(o.description !== undefined ? store().setBoardDescription(rest[0], text(o.description) ?? "") : store().boardDetail(rest[0]));
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
        return {
          id: v.id,
          ref: v.ref,
          column: v.column,
          title: v.title,
          priority: v.priority,
          labels: v.labels,
          due: v.due,
          claimedBy: v.claimedBy ? claimLabel(v.claimedBy) : null,
          updatedAt: v.updatedAt,
        };
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
        branch: o["no-branch"] ? null : o.branch,
        mrUrl: o["no-mr"] ? null : o.mr,
        mrState: o["mr-state"],
        due: o["no-due"] ? null : o.due,
      };
      if (Object.values(changes).every((v) => v === undefined)) throw new TodoomError("Rien à modifier : voir todoom --help");
      out(store().update(rest[0], changes));
      return 0;
    }

    case "move":
      need(2, "move <carte> <colonne> [--top] [--board <tableau>]");
      out(
        o.board
          ? store().moveToBoard(rest[0], o.board, rest.slice(1).join(" "))
          : store().move(rest[0], rest.slice(1).join(" "), o.top ? "top" : "bottom"),
      );
      return 0;

    case "link":
      need(3, "link <carte> <type> <autre carte>");
      out(store().link(rest[0], rest[1], rest[2]));
      return 0;

    case "unlink":
      need(2, "unlink <carte> <autre carte>");
      out(store().unlink(rest[0], rest[1]));
      return 0;

    case "claim":
      need(1, "claim <carte> [--move <colonne>] [--force]");
      out(store().claim(rest[0], { column: o.move, force: o.force, conversation: o.conversation ?? process.env.TODOOM_CONVERSATION }));
      return 0;

    case "release":
      need(1, "release <carte> [--force]");
      out(store().release(rest[0], { force: o.force, conversation: o.conversation ?? process.env.TODOOM_CONVERSATION }));
      return 0;

    case "branch":
      need(1, "branch <carte> [--save]");
      // Plain text, not JSON: made to be used in a git command.
      process.stdout.write(store().branch(rest[0], { save: o.save }) + "\n");
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
