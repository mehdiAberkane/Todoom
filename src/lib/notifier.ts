// Shows system notifications: through Tauri's plugin in the app, through the
// browser's Notification API under `vite dev`. Permission is asked the first
// time something is to be shown; a refusal is remembered by the system.
import { isTauri } from "./backend";
import type { Data } from "./store";
import { arrivals, dueOn, freshDue, noticesFor, notifySettings, type DueMemory, type Notice } from "./notify";
import { toISODate } from "./utils";

// Due cards already notified today, on this computer only.
const DUE_KEY = "todoom.notifiedDue";

function readMemory(): DueMemory | null {
  try {
    return JSON.parse(localStorage.getItem(DUE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeMemory(memory: DueMemory) {
  try {
    localStorage.setItem(DUE_KEY, JSON.stringify(memory));
  } catch {
    /* at worst, notified again */
  }
}

/** Given to the store: after each read, notifies what arrived in a watched column and what is due today. */
export function notifyChanges(prev: Data, next: Data, prevComplete: boolean) {
  const settings = notifySettings(next.settings);
  if (!settings.enabled) return;
  const arrived = arrivals(prev, next, settings.columns, prevComplete);
  let due: ReturnType<typeof dueOn> = [];
  if (settings.due) {
    const today = toISODate(new Date());
    const result = freshDue(dueOn(next, today), today, readMemory());
    due = result.fresh;
    writeMemory(result.memory);
  }
  show(noticesFor(arrived, due)).catch(() => {});
}

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

const plugin = () => import("@tauri-apps/plugin-notification");

export async function notifyPermission(): Promise<NotifyPermission> {
  if (isTauri) return (await (await plugin()).isPermissionGranted()) ? "granted" : "default";
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Asks for permission if needed; true when notifications can be shown. */
export async function ensurePermission(): Promise<boolean> {
  if (isTauri) {
    const p = await plugin();
    if (await p.isPermissionGranted()) return true;
    return (await p.requestPermission()) === "granted";
  }
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "default") await Notification.requestPermission();
  return Notification.permission === "granted";
}

export async function show(notices: Notice[]): Promise<void> {
  if (!notices.length || !(await ensurePermission())) return;
  if (isTauri) {
    const p = await plugin();
    for (const n of notices) p.sendNotification({ title: n.title, body: n.body });
    return;
  }
  for (const n of notices) new Notification(n.title, { body: n.body });
}
