import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";
import { imageToBackground } from "../lib/image";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  dataDir: string;
  onChangeDataDir: () => void;
  version: string | null;
  onBack: () => void;
}

const SAVE_DELAY_MS = 300;

export function SettingsPage({ settings, onSave, dataDir, onChangeDataDir, version, onBack }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dim, setDim] = useState(settings.backgroundDim);

  // The slider fires on every pixel; write the file once it settles.
  useEffect(() => {
    if (dim === settings.backgroundDim) return;
    const t = setTimeout(() => onSave({ ...settings, backgroundDim: dim }), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [dim]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onSave({ ...settings, backgroundDim: dim, background: await imageToBackground(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-head">
        <button className="btn-ghost" onClick={onBack}>
          ← Retour
        </button>
        <h1>⚙ Paramètres</h1>
      </header>

      <section className="settings-section">
        <h2>Fond d'écran</h2>
        <p className="muted">L'image est enregistrée dans ton dossier Drive : elle s'affiche sur tous tes PC.</p>

        <div className="bg-editor">
          <div
            className="bg-preview"
            style={
              settings.background
                ? { backgroundImage: `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url(${settings.background})` }
                : undefined
            }
          >
            {!settings.background && <span className="muted">Fond noir par défaut</span>}
            <div className="bg-preview-card">Aperçu d'une carte</div>
          </div>

          <div className="bg-controls">
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button className="btn-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? "Préparation…" : settings.background ? "Changer d'image…" : "Choisir une image…"}
            </button>
            {settings.background && (
              <button className="btn-ghost" onClick={() => onSave({ ...settings, backgroundDim: dim, background: null })}>
                Retirer l'image
              </button>
            )}

            <label className="dim-label" htmlFor="bg-dim">
              Assombrissement <span className="muted">{Math.round(dim * 100)} %</span>
            </label>
            <input
              id="bg-dim"
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={dim}
              disabled={!settings.background}
              onChange={(e) => setDim(Number(e.target.value))}
            />
            <p className="hint">Plus c'est sombre, plus les cartes restent lisibles sur une image claire.</p>
            {error && <div className="error-box">{error}</div>}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Dossier de données</h2>
        <div className="settings-row">
          <code className="settings-path">{dataDir}</code>
          <button className="btn-ghost" onClick={onChangeDataDir}>
            Changer…
          </button>
        </div>
      </section>

      {version && (
        <section className="settings-section">
          <h2>À propos</h2>
          <p className="muted">Todoom v{version}</p>
        </section>
      )}
    </div>
  );
}
