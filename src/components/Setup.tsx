import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { t } from "../lib/i18n";

export function Setup({ current, onDone, onCancel }: { current: string | null; onDone: (dir: string) => void; onCancel?: () => void }) {
  const [path, setPath] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current) backend.suggestDataDir().then((s) => s && setPath((p) => p || s));
  }, [current]);

  const browse = async () => {
    const picked = await backend.pickFolder();
    if (picked) setPath(picked);
  };

  const submit = async () => {
    const p = path.trim();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await backend.setDataDir(p);
      onDone(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-box">
        <div className="setup-skull">💀</div>
        <h1>TODOOM</h1>
        <p className="tagline">{t("setup.tagline")}</p>

        <label className="setup-label">{t("setup.label")}</label>
        <div className="setup-row">
          {/* Chosen with the dialog only: the app accepts the folder picked there, the Drive folder it proposes, or the current one. */}
          <input value={path} readOnly onClick={browse} placeholder={t("setup.placeholder")} onKeyDown={(e) => e.key === "Enter" && submit()} title={t("setup.browse")} />
          <button className="btn-ghost" onClick={browse}>
            {t("setup.browse")}
          </button>
        </div>
        <p className="hint">
          {t("setup.hint")} <code>{t("setup.macPath")}</code>.
        </p>
        {error && <div className="error-box">{error}</div>}
        <div className="setup-actions">
          {onCancel && (
            <button className="btn-ghost" onClick={onCancel}>
              {t("common.cancel")}
            </button>
          )}
          <button className="btn-primary big" disabled={busy || !path.trim()} onClick={submit}>
            {busy ? "…" : t("setup.go")}
          </button>
        </div>
      </div>
    </div>
  );
}
