import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./backend";
import { webUrl } from "./dev";

/** Opens a web address in the system's browser, never inside the app's window. */
export async function openExternal(text: string) {
  const url = webUrl(text);
  if (!url) return;
  if (isTauri) await openUrl(url).catch(() => {});
  else window.open(url, "_blank", "noopener,noreferrer");
}
