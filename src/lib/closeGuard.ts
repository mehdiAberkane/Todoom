import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./backend";

/**
 * Keeps the window open while changes are still waiting for the disk: tries
 * once more, then asks before quitting and losing them.
 */
export function useCloseGuard(unsavedCount: number, retryNow: () => Promise<void>) {
  const count = useRef(unsavedCount);
  count.current = unsavedCount;

  useEffect(() => {
    if (!isTauri) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (count.current) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }

    const win = getCurrentWindow();
    const off = win.onCloseRequested(async (event) => {
      if (!count.current) return;
      event.preventDefault();
      await retryNow();
      const left = count.current;
      if (
        !left ||
        (await ask(
          `${left} modification${left > 1 ? "s n'ont" : " n'a"} pas pu être enregistrée${left > 1 ? "s" : ""} sur le disque ` +
            `(détails en bas de la barre latérale).\n\nSi tu quittes maintenant, ${left > 1 ? "elles seront perdues" : "elle sera perdue"}.`,
          { title: "Todoom", kind: "warning", okLabel: "Quitter quand même", cancelLabel: "Rester" },
        ))
      ) {
        await win.destroy();
      }
    });
    return () => {
      off.then((unlisten) => unlisten());
    };
  }, [retryNow]);
}
