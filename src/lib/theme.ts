// Appearance: dark or light theme (or the system's), and compact cards. The
// choice is in the shared settings; it is applied as attributes on <html>,
// which the stylesheet reads (data-theme, data-density).
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppSettings } from "../types";
import { isTauri } from "./backend";
import { resolveTheme } from "./appearance";

const darkQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

/** Applies the appearance settings to the page (and the window's title bar), and returns the theme shown. */
export function useAppearance(settings: Pick<AppSettings, "theme" | "compact">): "dark" | "light" {
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? true);
  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const change = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  const theme = resolveTheme(settings.theme, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // The native title bar follows too; refused or unsupported, it keeps the system's.
    if (isTauri) getCurrentWindow().setTheme(theme).catch(() => {});
  }, [theme]);

  const compact = !!settings.compact;
  useEffect(() => {
    if (compact) document.documentElement.dataset.density = "compact";
    else delete document.documentElement.dataset.density;
  }, [compact]);

  return theme;
}
