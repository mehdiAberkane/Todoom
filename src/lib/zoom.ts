import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { localGet, localSet } from "./utils";

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const KEY = "todoom-zoom";
/** Wheel distance for one step: one notch of a mouse wheel, a short pinch on a trackpad. */
const WHEEL_STEP = 50;

/** The level `steps` away from `current` (snapped to the nearest known level first). */
export function stepZoom(current: number, steps: number): number {
  let i = 0;
  for (let j = 1; j < ZOOM_LEVELS.length; j++) {
    if (Math.abs(ZOOM_LEVELS[j] - current) < Math.abs(ZOOM_LEVELS[i] - current)) i = j;
  }
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + steps))];
}

export function savedZoom(): number {
  const z = Number(localGet(KEY));
  return ZOOM_LEVELS.includes(z) ? z : 1;
}

/**
 * Ctrl (Cmd on a Mac) + wheel, + / - / 0 zoom the whole window, like a browser;
 * a trackpad pinch arrives as Ctrl + wheel too. The level is kept per machine.
 * Returns the level and a counter that changes on each zoom, to show it briefly.
 * In a plain browser, the browser's own zoom already does this.
 */
export function useZoom() {
  const [zoom, setZoom] = useState(savedZoom);
  const [changes, setChanges] = useState(0);
  const current = useRef(zoom);
  const wheel = useRef(0);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    getCurrentWebview().setZoom(current.current).catch(() => {});

    const apply = (z: number) => {
      if (z === current.current) return;
      current.current = z;
      setZoom(z);
      setChanges((n) => n + 1);
      localSet(KEY, String(z));
      getCurrentWebview().setZoom(z).catch(() => {});
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      wheel.current += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
      // One level per wheel notch, whatever distance the system gives a notch.
      if (Math.abs(wheel.current) < WHEEL_STEP) return;
      const up = wheel.current < 0;
      wheel.current = 0;
      apply(stepZoom(current.current, up ? 1 : -1));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") apply(stepZoom(current.current, 1));
      else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") apply(stepZoom(current.current, -1));
      // On a French keyboard 0 needs Shift, so the key's position counts too.
      else if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") apply(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return { zoom, changes };
}
