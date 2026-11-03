import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileEntry {
  /** Relative to the data folder, always with "/" separators. */
  path: string;
  content: string;
}

export interface Backend {
  kind: "tauri" | "browser";
  getDataDir(): Promise<string | null>;
  setDataDir(path: string): Promise<void>;
  suggestDataDir(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  hostname(): Promise<string>;
  loadAll(): Promise<FileEntry[]>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Fires when another machine changed the data folder. */
  onChange(cb: () => void): Promise<() => void>;
}

const tauriBackend: Backend = {
  kind: "tauri",
  getDataDir: () => invoke<string | null>("get_data_dir"),
  setDataDir: (path) => invoke("set_data_dir", { path }),
  suggestDataDir: () => invoke<string | null>("suggest_data_dir"),
  pickFolder: async () => {
    const picked = await open({ directory: true, title: "Où ranger les données Todoom ?" });
    return typeof picked === "string" ? picked : null;
  },
  hostname: () => invoke<string>("hostname"),
  loadAll: () => invoke<FileEntry[]>("load_all"),
  write: (path, content) => invoke("write_file", { path, content }),
  remove: (path) => invoke("remove_path", { path }),
  onChange: (cb) => listen("todoom://changed", () => cb()),
};

// Lets the UI run in a plain browser (vite dev) with the same file layout kept in localStorage.
const FS_KEY = "todoom-fs";

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
  getDataDir: async () => "localStorage (mode navigateur)",
  setDataDir: async () => {},
  suggestDataDir: async () => null,
  pickFolder: async () => null,
  hostname: async () => "navigateur",
  loadAll: async () => Object.entries(readFs()).map(([path, content]) => ({ path, content })),
  write: async (path, content) => {
    const fs = readFs();
    fs[path] = content;
    writeFs(fs);
  },
  remove: async (path) => {
    const fs = readFs();
    for (const key of Object.keys(fs)) {
      if (key === path || key.startsWith(path + "/")) delete fs[key];
    }
    writeFs(fs);
  },
  onChange: async (cb) => {
    const handler = (e: StorageEvent) => e.key === FS_KEY && cb();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};

export const isTauri = "__TAURI_INTERNALS__" in window;

export const backend: Backend = isTauri ? tauriBackend : browserBackend;
