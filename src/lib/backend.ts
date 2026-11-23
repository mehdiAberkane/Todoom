import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "./i18n";
import { restorePlan, type SnapshotInfo } from "./snapshots";
import type { InboxFile } from "./inbox";

export interface FileEntry {
  /** Relative to the data folder, always with "/" separators. */
  path: string;
  content: string;
}

/** A load of the data folder: the files read, and those not available yet (Google Drive still downloading them). */
export interface Loaded {
  files: FileEntry[];
  pending: string[];
}

export interface Backend {
  kind: "tauri" | "browser";
  getDataDir(): Promise<string | null>;
  setDataDir(path: string): Promise<void>;
  suggestDataDir(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  hostname(): Promise<string>;
  loadAll(): Promise<Loaded>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Fires when another machine changed the data folder. */
  onChange(cb: () => void): Promise<() => void>;
  /** Writes an attached file once (base64), next to its card. */
  writeAttachment(path: string, base64: string): Promise<void>;
  readAttachment(path: string): Promise<string>;
  /** Shows the attached file in the system's file manager. */
  revealAttachment(path: string): Promise<void>;
  /** Language of the messages the backend itself writes (refusals, errors). */
  setLanguage(lang: "fr" | "en"): Promise<void>;
  /** Saves an export (Markdown, CSV) where the user chooses; false when they cancel. */
  saveExport(fileName: string, content: string): Promise<boolean>;
  /** The plain text summaries for the phone, in the data folder's « lecture » subfolder (see reading.ts). */
  listReading(): Promise<string[]>;
  writeReading(name: string, content: string): Promise<void>;
  removeReading(name: string): Promise<void>;
  /** Ideas dropped from the phone into the data folder's inbox (see inbox.ts). */
  listInbox(): Promise<InboxFile[]>;
  readInbox(name: string): Promise<string>;
  removeInbox(name: string): Promise<void>;
  /** The open pull/merge requests of a repository, as gh or glab print them (see reviews.ts). */
  listReviews(forge: string, host: string, path: string, merged?: boolean): Promise<string>;
  /** Forge hosts allowed (true) or refused (false) on this computer, besides github.com and gitlab.com. */
  forgeHosts(): Promise<Record<string, boolean>>;
  setForgeHost(host: string, allowed: boolean): Promise<void>;
  /** Snapshots of the data folder, kept on this computer (see snapshots.ts), newest first. */
  listSnapshots(): Promise<SnapshotInfo[]>;
  saveSnapshot(name: string, content: string): Promise<void>;
  deleteSnapshot(name: string): Promise<void>;
  /** Puts the data files back as in the snapshot; the data files made since are removed. */
  restoreSnapshot(name: string): Promise<{ written: number; removed: number }>;
}

const tauriBackend: Backend = {
  kind: "tauri",
  getDataDir: () => invoke<string | null>("get_data_dir"),
  setDataDir: (path) => invoke("set_data_dir", { path }),
  suggestDataDir: () => invoke<string | null>("suggest_data_dir"),
  // The dialogs are opened from Rust, which keeps what they return: a folder or a
  // save path can only be one the user chose, never one made up by the page.
  pickFolder: () => invoke<string | null>("pick_data_dir", { title: t("setup.pickTitle") }),
  hostname: () => invoke<string>("hostname"),
  loadAll: () => invoke<Loaded>("load_all"),
  write: (path, content) => invoke("write_file", { path, content }),
  remove: (path) => invoke("remove_path", { path }),
  onChange: (cb) => listen("todoom://changed", () => cb()),
  setLanguage: (lang) => invoke("set_language", { lang }),
  writeAttachment: (path, data) => invoke("write_attachment", { path, data }),
  readAttachment: (path) => invoke<string>("read_attachment", { path }),
  revealAttachment: (path) => invoke("reveal_attachment", { path }),
  saveExport: (fileName, content) => invoke<boolean>("save_export", { fileName, content }),
  listReading: () => invoke<string[]>("list_reading"),
  writeReading: (name, content) => invoke("write_reading", { name, content }),
  removeReading: (name) => invoke("remove_reading", { name }),
  listInbox: () => invoke<InboxFile[]>("list_inbox"),
  readInbox: (name) => invoke<string>("read_inbox", { name }),
  removeInbox: (name) => invoke("remove_inbox", { name }),
  listReviews: (forge, host, path, merged = false) => invoke<string>("list_reviews", { forge, host, path, merged }),
  forgeHosts: () => invoke<Record<string, boolean>>("forge_hosts"),
  setForgeHost: (host, allowed) => invoke("set_forge_host", { host, allowed }),
  listSnapshots: () => invoke<SnapshotInfo[]>("list_snapshots"),
  saveSnapshot: (name, content) => invoke("save_snapshot", { name, content }),
  deleteSnapshot: (name) => invoke("delete_snapshot", { name }),
  restoreSnapshot: (name) => invoke<{ written: number; removed: number }>("restore_snapshot", { name }),
};

// Lets the UI run in a plain browser (vite dev) with the same file layout kept in localStorage.
const FS_KEY = "todoom-fs";
// Attached files, kept apart: they are never part of a load.
const ATTACH_KEY = "todoom-attachments";
const readAttachments = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(ATTACH_KEY) ?? "{}");
  } catch {
    return {};
  }
};

// Forge hosts allowed or refused, as the app keeps them in its own settings.
const FORGE_HOSTS_KEY = "todoom-forge-hosts";
const readForgeHosts = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(FORGE_HOSTS_KEY) ?? "{}");
  } catch {
    return {};
  }
};

// The inbox, by file name: a test puts ideas there as the phone would.
const INBOX_KEY = "todoom-inbox";
const readInboxStore = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(INBOX_KEY) ?? "{}");
  } catch {
    return {};
  }
};

// The phone summaries, by name.
const READING_KEY = "todoom-reading";
const readReading = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(READING_KEY) ?? "{}");
  } catch {
    return {};
  }
};

// Snapshots, by name: in the browser they live next to the files.
const SNAP_KEY = "todoom-snapshots";
const readSnapshots = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SNAP_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const writeSnapshots = (all: Record<string, string>) => localStorage.setItem(SNAP_KEY, JSON.stringify(all));

function readFs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeFs(fs: Record<string, string>) {
  localStorage.setItem(FS_KEY, JSON.stringify(fs));
}

const browserBackend: Backend = {
  kind: "browser",
  getDataDir: async () => t("dev.browserDataDir"),
  setDataDir: async () => {},
  suggestDataDir: async () => null,
  pickFolder: async () => null,
  hostname: async () => "navigateur",
  loadAll: async () => ({ files: Object.entries(readFs()).map(([path, content]) => ({ path, content })), pending: [] }),
  write: async (path, content) => {
    const fs = readFs();
    // Same rule as the desktop backend: never overwrite a file that isn't valid JSON.
    if (path in fs) {
      try {
        JSON.parse(fs[path]);
      } catch {
        throw new Error(t("error.unreadable", { path }));
      }
    }
    fs[path] = content;
    writeFs(fs);
  },
  remove: async (path) => {
    const fs = readFs();
    const files = readAttachments();
    const under = (key: string) => key === path || key.startsWith(path + "/");
    for (const key of Object.keys(fs)) if (under(key)) delete fs[key];
    for (const key of Object.keys(files)) if (under(key)) delete files[key];
    writeFs(fs);
    localStorage.setItem(ATTACH_KEY, JSON.stringify(files));
  },
  onChange: async (cb) => {
    const handler = (e: StorageEvent) => e.key === FS_KEY && cb();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
  setLanguage: async () => {},
  writeAttachment: async (path, data) => {
    const files = readAttachments();
    if (path in files) throw new Error(`${path} existe déjà`);
    files[path] = data;
    localStorage.setItem(ATTACH_KEY, JSON.stringify(files));
  },
  readAttachment: async (path) => {
    const data = readAttachments()[path];
    if (data === undefined) throw new Error(`${path} introuvable`);
    return data;
  },
  revealAttachment: async () => {},
  saveExport: async (fileName, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: fileName.endsWith(".csv") ? "text/csv" : "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  // Kept apart from the data files: they aren't JSON, a load would report them.
  listReading: async () => Object.keys(readReading()),
  writeReading: async (name, content) => localStorage.setItem(READING_KEY, JSON.stringify({ ...readReading(), [name]: content })),
  removeReading: async (name) => {
    const all = readReading();
    delete all[name];
    localStorage.setItem(READING_KEY, JSON.stringify(all));
  },
  listInbox: async () => Object.entries(readInboxStore()).map(([name, content]) => ({ name, size: content.length })),
  readInbox: async (name) => {
    const content = readInboxStore()[name];
    if (content === undefined) throw new Error(`${name} introuvable`);
    return content;
  },
  removeInbox: async (name) => {
    const all = readInboxStore();
    delete all[name];
    localStorage.setItem(INBOX_KEY, JSON.stringify(all));
  },
  // No gh or glab in a browser: a test puts their output in localStorage, by "forge:host/path".
  listReviews: async (forge, host, path, merged = false) => {
    // The same rule as the app: a host other than the default ones is asked first.
    const choice = readForgeHosts()[host];
    if (!["github.com", "gitlab.com"].includes(host) && choice !== true) throw new Error(`${choice === false ? "refused" : "unapproved"}:${host}`);
    const all = JSON.parse(localStorage.getItem("todoom-reviews") ?? "{}") as Record<string, string>;
    const output = all[`${forge}:${host}/${path}${merged ? ":merged" : ""}`];
    if (output === undefined) throw new Error("desktop");
    if (output.startsWith("error:")) throw new Error(output.slice(6));
    return output;
  },
  forgeHosts: async () => readForgeHosts(),
  setForgeHost: async (host, allowed) => localStorage.setItem(FORGE_HOSTS_KEY, JSON.stringify({ ...readForgeHosts(), [host]: allowed })),
  listSnapshots: async () =>
    Object.entries(readSnapshots())
      .map(([name, content]) => ({ name, size: content.length }))
      .sort((a, b) => b.name.localeCompare(a.name)),
  saveSnapshot: async (name, content) => writeSnapshots({ ...readSnapshots(), [name]: content }),
  deleteSnapshot: async (name) => {
    const all = readSnapshots();
    delete all[name];
    writeSnapshots(all);
  },
  restoreSnapshot: async (name) => {
    const raw = readSnapshots()[name];
    if (raw === undefined) throw new Error(`${name} introuvable`);
    const files = readFs();
    const plan = restorePlan(JSON.parse(raw), Object.keys(files));
    for (const path of plan.remove) delete files[path];
    for (const [path, content] of plan.write) files[path] = content;
    writeFs(files);
    return { written: plan.write.length, removed: plan.remove.length };
  },
};

// Outside a browser (the tests, the todoom command) there is no window: not Tauri.
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const backend: Backend = isTauri ? tauriBackend : browserBackend;
