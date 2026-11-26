import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ZoomIndicator } from "./components/ZoomIndicator";
import { CaptureWindow } from "./components/CaptureWindow";
import { PrPopupWindow } from "./components/PrPopupWindow";
import type { PrNotice } from "./lib/reviewWatch";
import { isTauri } from "./lib/backend";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The same page serves the main window, the small quick capture one and the PR/MR popup.
const label = isTauri ? getCurrentWindow().label : "";
const capture = label === "capture";
if (capture) document.documentElement.classList.add("capture-page");
// Under `vite dev` in a browser, ?prpopup-demo shows the popup with sample notices.
const demo = !isTauri && import.meta.env.DEV && new URLSearchParams(location.search).has("prpopup-demo");
const prPopup = label === "prpopup" || demo;
if (prPopup) document.documentElement.classList.add("prpopup-page");
const DEMO: PrNotice[] = [
  { id: "1", kind: "opened", repo: "mehdiAberkane/Todoom", number: "#61", title: "Notifications PR/MR en popup", author: "mehdiAberkane", url: "https://github.com/mehdiAberkane/Todoom/pull/61", card: "TOD-60" },
  { id: "2", kind: "ciFailed", repo: "mehdiAberkane/Todoom", number: "#5", title: "Bump typescript from 6.0.3 to 7.0.2", author: "dependabot", url: "https://github.com/mehdiAberkane/Todoom/pull/5", card: null },
  { id: "3", kind: "merged", repo: "mehdiAberkane/ongaku", number: "#31", title: "Listes automatiques supplémentaires et taille réglable", author: "mehdiAberkane", url: "https://github.com/mehdiAberkane/ongaku/pull/31", card: null },
  { id: "5", kind: "releaseStarted", repo: "mehdiAberkane/Todoom", number: "v0.16.2", title: "", author: "", url: "https://github.com/mehdiAberkane/Todoom/actions", card: null },
  { id: "6", kind: "releasePublished", repo: "mehdiAberkane/Todoom", number: "v0.16.1", title: "", author: "", url: "https://github.com/mehdiAberkane/Todoom/releases/tag/v0.16.1", card: null },
  { id: "4", kind: "more", repo: "", number: "", title: "", author: "", url: "", card: null, count: 2 },
];

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {prPopup ? (
      <PrPopupWindow demo={demo ? DEMO : undefined} />
    ) : capture ? (
      <CaptureWindow />
    ) : (
      <>
        <App />
        <ZoomIndicator />
      </>
    )}
  </React.StrictMode>,
);
