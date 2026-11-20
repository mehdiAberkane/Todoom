import { describe, expect, it } from "vitest";
import { isStale } from "../components/AgentStatus";
import { parse } from "./store";
import type { AgentStatus } from "../types";

const status = (patch: Partial<AgentStatus> = {}): AgentStatus => ({
  host: "PC-Main",
  agent: "todoom-agent",
  state: "idle",
  card: null,
  since: "2026-11-20T10:00:00.000Z",
  heartbeat: "2026-11-20T10:00:00.000Z",
  pollSeconds: 30,
  ...patch,
});

describe("agent status", () => {
  const at = (minutes: number) => Date.parse("2026-11-20T10:00:00.000Z") + minutes * 60_000;

  it("turns silent after three minutes without news, never when stopped", () => {
    expect(isStale(status(), at(2))).toBe(false);
    expect(isStale(status(), at(4))).toBe(true);
    expect(isStale(status({ pollSeconds: 300 }), at(10))).toBe(false);
    expect(isStale(status({ state: "stopped" }), at(60))).toBe(false);
  });

  it("is read per board, one file per agent, the freshest copy kept", () => {
    const board = JSON.stringify({ id: "b1", name: "B", columns: [], labels: [], updatedAt: "1" });
    const data = parse([
      { path: "boards/b1/board.json", content: board },
      { path: "boards/b1/agents/PC-Main-agent.json", content: JSON.stringify(status()) },
      { path: "boards/b1/agents/PC-Main-agent (1).json", content: JSON.stringify(status({ state: "working", heartbeat: "2026-11-20T10:05:00.000Z" })) },
      { path: "boards/b1/agents/PC-Portable-agent.json", content: JSON.stringify(status({ host: "PC-Portable" })) },
      { path: "boards/b1/agents/broken.json", content: JSON.stringify({ host: "x", state: "dancing" }) },
    ]);
    expect(data.agents.b1.map((a) => [a.host, a.state])).toEqual([
      ["PC-Main", "working"],
      ["PC-Portable", "idle"],
    ]);
    expect(data.issues.map((i) => i.path)).toEqual(["boards/b1/agents/broken.json"]);
  });
});
