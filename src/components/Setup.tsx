import { useEffect, useState } from "react";
import { backend } from "../lib/backend";

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
        <p className="tagline">Tes tickets sont condamnés à être finis.</p>

        <label className="setup-label">Dossier de données (dans ton Google Drive pour la synchro entre PC)</label>
        <div className="setup-row">
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="G:\Mon Drive\Todoom" onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button className="btn-ghost" onClick={browse}>
            Parcourir…
          </button>
        </div>
        <p className="hint">
          Sur chaque PC, pointe vers le même dossier synchronisé. Sur Mac, c'est en général
          <code>~/Library/CloudStorage/GoogleDrive-…/Mon Drive/Todoom</code>.
        </p>
        {error && <div className="error-box">{error}</div>}
        <div className="setup-actions">
          {onCancel && (
            <button className="btn-ghost" onClick={onCancel}>
              Annuler
            </button>
          )}
          <button className="btn-primary big" disabled={busy || !path.trim()} onClick={submit}>
            {busy ? "…" : "C'est parti 🔥"}
          </button>
        </div>
      </div>
    </div>
  );
}
