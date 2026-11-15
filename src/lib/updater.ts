import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./backend";

const FIRST_CHECK_MS = 5_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "available"; version: string }
  | { kind: "installing"; progress: number | null }
  | { kind: "error"; message: string };

/** Checks GitHub Releases for a signed update and installs it on demand. */
export function useUpdater() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    if (!isTauri) return;
    getVersion().then(setVersion, () => {});
    const run = () =>
      check()
        .then((found) => {
          if (!found) return;
          setUpdate(found);
          setState((s) => (s.kind === "installing" ? s : { kind: "available", version: found.version }));
        })
        // Offline or GitHub unreachable: try again at the next check.
        .catch(() => {});
    const first = window.setTimeout(run, FIRST_CHECK_MS);
    const timer = window.setInterval(run, CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const install = useCallback(async () => {
    if (!update) return;
    let total = 0;
    let done = 0;
    setState({ kind: "installing", progress: null });
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          if (total) setState({ kind: "installing", progress: done / total });
        }
      });
      // On Windows the installer closes the app itself; macOS needs the restart.
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }, [update]);

  return { version, state, install };
}
