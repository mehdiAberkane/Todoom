import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CAPTURE_BOARDS, CAPTURE_HELLO, CAPTURE_SEND, type CaptureTarget } from "../lib/capture";
import { t } from "../lib/i18n";
import { CaptureForm } from "./QuickCapture";

/**
 * The quick capture window (opened by the global shortcut or the notification
 * area icon): asks the main window for the boards, sends it the idea, closes.
 */
export function CaptureWindow() {
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    // Asked again until the main window, maybe still reading the folder, answers.
    const ask = () => emitTo("main", CAPTURE_HELLO).catch(() => {});
    const id = window.setInterval(ask, 1000);
    const off = listen<CaptureTarget>(CAPTURE_BOARDS, (e) => {
      window.clearInterval(id);
      setTarget(e.payload);
    });
    ask();
    return () => {
      window.clearInterval(id);
      off.then((f) => f());
    };
  }, []);

  const close = () => getCurrentWindow().close();
  return (
    <div className="capture-window">
      {sent ? (
        <p className="capture-sent">{t("capture.sent", { board: sent })}</p>
      ) : (
        <CaptureForm
          target={target}
          onCancel={close}
          onSubmit={(boardId, title) => {
            emitTo("main", CAPTURE_SEND, { boardId, title })
              .then(() => {
                setSent(target?.boards.find((b) => b.id === boardId)?.name ?? "");
                window.setTimeout(close, 700);
              })
              .catch(close);
          }}
        />
      )}
    </div>
  );
}
