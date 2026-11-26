// The dependencies of a board as a graph (TOD-73): which card waits for which,
// across boards too. « A depends on B » is stored on A (and « B blocks A » on B):
// here it is the edge B → A, B to finish first. Pure, tested; DependencyGraph draws it.
import type { Board, Card } from "../types";
import { isFinished, type Located } from "./links";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const DOING = ["en cours", "in progress", "doing"];

export type NodeState = "done" | "doing" | "todo" | "blocked";

export interface GraphNode {
  card: Card;
  board: Board;
  /** On another board than the one shown. */
  outside: boolean;
  state: NodeState;
  /** Left to right: 0 for those depending on nothing, else one more than their furthest dependency. */
  layer: number;
  /** Not finished, and nothing it depends on is unfinished: can be taken now. */
  ready: boolean;
  /** Unfinished cards waiting on it, directly or further down. */
  unblocks: number;
  /** In a cycle: A depends on B that depends (maybe through others) on A. */
  inCycle: boolean;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  /** from → to: `to` depends on `from`. */
  edges: { from: string; to: string }[];
  /** The longest run of unfinished cards each waiting on the one before, first to last. */
  longestChain: string[];
  /** Each cycle's cards. */
  cycles: string[][];
}

/**
 * What each card depends on: its « depends on » links, and the cards that say they
 * block it (a link written on one card only, by an older file, counts too).
 */
function dependencyMap(index: Map<string, Located>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const add = (waiter: string, first: string) => {
    if (waiter === first || !index.has(first) || !index.has(waiter)) return;
    if (!out.has(waiter)) out.set(waiter, new Set());
    out.get(waiter)!.add(first);
  };
  for (const { card } of index.values())
    for (const l of card.links) {
      if (l.type === "dependsOn") add(card.id, l.cardId);
      if (l.type === "blocks") add(l.cardId, card.id);
    }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

function stateOf(card: Card, board: Board, waiting: boolean): NodeState {
  if (isFinished(card, board)) return "done";
  if (waiting) return "blocked";
  const column = board.columns.find((c) => c.id === card.columnId);
  return column && DOING.includes(plain(column.name)) ? "doing" : "todo";
}

/** Strongly connected groups of more than one card (or a card depending on itself): the cycles. */
function cyclesOf(ids: string[], deps: Map<string, string[]>): string[][] {
  // Tarjan, on « depends on » edges.
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1 || (deps.get(v) ?? []).includes(v)) out.push(group.reverse());
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return out;
}

/**
 * The graph of a board: its cards that depend on or block another one, and the
 * cards of other boards they are linked to. Archived cards are left out (they
 * count as finished, so they block nothing).
 */
export function dependencyGraph(board: Board, index: Map<string, Located>): DependencyGraph {
  const live = (id: string) => !!index.get(id) && !index.get(id)!.card.archivedAt;
  const deps = new Map([...dependencyMap(index)].filter(([id]) => live(id)).map(([id, list]) => [id, list.filter(live)]));
  // The board's cards in a dependency, and whatever they are linked to.
  const ids = new Set<string>();
  for (const [id, list] of deps) {
    const here = index.get(id)!.board.id === board.id;
    if (here && list.length) [id, ...list].forEach((x) => ids.add(x));
    for (const d of list) if (index.get(d)!.board.id === board.id) [id, d].forEach((x) => ids.add(x));
  }
  const nodesIds = [...ids];
  const edges = nodesIds.flatMap((to) => (deps.get(to) ?? []).filter((from) => ids.has(from)).map((from) => ({ from, to })));
  const cycles = cyclesOf(nodesIds, deps);
  const inCycle = new Set(cycles.flat());
  const finished = (id: string) => isFinished(index.get(id)!.card, index.get(id)!.board);

  // Layers: the furthest dependency plus one. A cycle is cut at the one edge that
  // leads back to a card being placed, so its cards still go left to right.
  const layer = new Map<string, number>();
  const placing = new Set<string>();
  const layerOf = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (placing.has(id)) return -1;
    placing.add(id);
    const parents = (deps.get(id) ?? []).filter((d) => ids.has(d));
    const value = Math.max(-1, ...parents.map(layerOf)) + 1;
    placing.delete(id);
    layer.set(id, value);
    return value;
  };
  nodesIds.forEach(layerOf);

  // Who waits on whom, unfinished only: what each card unblocks, the longest chain.
  const dependents = new Map<string, string[]>();
  for (const e of edges) if (!finished(e.to)) dependents.set(e.from, [...(dependents.get(e.from) ?? []), e.to]);
  const reach = (id: string) => {
    const seen = new Set<string>();
    const walk = (x: string) => (dependents.get(x) ?? []).forEach((y) => !seen.has(y) && y !== id && (seen.add(y), walk(y)));
    walk(id);
    return seen.size;
  };
  const chain = new Map<string, string[]>();
  const chainFrom = (id: string, seen: Set<string>): string[] => {
    if (chain.has(id)) return chain.get(id)!;
    if (seen.has(id) || finished(id)) return [];
    seen.add(id);
    const best = (dependents.get(id) ?? []).map((d) => chainFrom(d, seen)).reduce((a, b) => (b.length > a.length ? b : a), [] as string[]);
    seen.delete(id);
    const value = [id, ...best];
    if (!inCycle.has(id)) chain.set(id, value);
    return value;
  };
  const longestChain = nodesIds
    .filter((id) => !finished(id))
    .map((id) => chainFrom(id, new Set()))
    .reduce((a, b) => (b.length > a.length ? b : a), [] as string[]);

  const nodes: GraphNode[] = nodesIds.map((id) => {
    const { card, board: b } = index.get(id)!;
    const waiting = (deps.get(id) ?? []).some((d) => !finished(d));
    const state = stateOf(card, b, waiting);
    return { card, board: b, outside: b.id !== board.id, state, layer: layer.get(id) ?? 0, ready: state !== "done" && !waiting, unblocks: finished(id) ? 0 : reach(id), inCycle: inCycle.has(id) };
  });
  nodes.sort((a, b) => a.layer - b.layer || Number(a.outside) - Number(b.outside) || a.card.title.localeCompare(b.card.title));
  return { nodes, edges, longestChain: longestChain.length > 1 ? longestChain : [], cycles };
}

/**
 * Whether linking `fromId` to `toId` with `type` would close a cycle: « A depends
 * on B » when B already depends (maybe through others) on A; « A blocks B » when A
 * already depends on B. Refused by the app, the command and the MCP server.
 */
export function createsCycle(fromId: string, type: string, toId: string, dependsOn: (id: string) => string[]): boolean {
  const [waiter, first] = type === "dependsOn" ? [fromId, toId] : type === "blocks" ? [toId, fromId] : [null, null];
  if (!waiter || !first) return false;
  if (waiter === first) return true;
  // Does `first` already depend on `waiter`?
  const seen = new Set<string>();
  const stack = [first];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === waiter) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...dependsOn(id));
  }
  return false;
}

/** What a card depends on, from the cards of every board: for createsCycle. */
export function dependsOnIn(index: Map<string, Located>): (id: string) => string[] {
  const map = dependencyMap(index);
  return (id) => map.get(id) ?? [];
}
