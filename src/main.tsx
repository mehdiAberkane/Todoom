import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ZoomIndicator } from "./components/ZoomIndicator";
import { CaptureWindow } from "./components/CaptureWindow";
import { isTauri } from "./lib/backend";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The same page serves the main window and the small quick capture one.
const capture = isTauri && getCurrentWindow().label === "capture";
if (capture) document.documentElement.classList.add("capture-page");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {capture ? (
      <CaptureWindow />
    ) : (
      <>
        <App />
        <ZoomIndicator />
      </>
    )}
  </React.StrictMode>,
);
