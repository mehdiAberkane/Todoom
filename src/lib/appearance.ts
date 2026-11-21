// Appearance choices, without the page: what the settings ask for, and what is shown.
import type { AppSettings } from "../types";

export type ThemeChoice = NonNullable<AppSettings["theme"]>;
export const THEMES: ThemeChoice[] = ["dark", "light", "system"];

/** The theme shown: dark unless light is chosen, or the system is light and followed. */
export function resolveTheme(choice: AppSettings["theme"], systemDark: boolean): "dark" | "light" {
  if (choice === "light") return "light";
  if (choice === "system") return systemDark ? "dark" : "light";
  return "dark";
}

/** What covers a background image to keep cards readable: darkening on the dark theme, lightening on the light one. */
export function veilOf(theme: "dark" | "light", dim: number): string {
  const tint = theme === "light" ? "255,255,255" : "0,0,0";
  return `linear-gradient(rgba(${tint},${dim}), rgba(${tint},${dim}))`;
}
