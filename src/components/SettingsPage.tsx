import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";
import { imageToBackground } from "../lib/image";
import { t } from "../lib/i18n";

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
    const timer = setTimeout(() => onSave({ ...settings, backgroundDim: dim }), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
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
          {t("settings.back")}
        </button>
        <h1>{t("sidebar.settings")}</h1>
      </header>

      <section className="settings-section">
        <h2>{t("settings.language")}</h2>
        <select
          className="settings-select"
          value={settings.language ?? "auto"}
          onChange={(e) => onSave({ ...settings, backgroundDim: dim, language: e.target.value === "auto" ? null : (e.target.value as "fr" | "en") })}
        >
          <option value="auto">{t("settings.languageAuto")}</option>
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </section>

      <section className="settings-section">
        <h2>{t("settings.background")}</h2>
        <p className="muted">{t("settings.backgroundShared")}</p>

        <div className="bg-editor">
          <div
            className="bg-preview"
            style={
              settings.background
                ? { backgroundImage: `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${settings.background}")` }
                : undefined
            }
          >
            {!settings.background && <span className="muted">{t("settings.backgroundDefault")}</span>}
            <div className="bg-preview-card">{t("settings.cardPreview")}</div>
          </div>

          <div className="bg-controls">
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button className="btn-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? t("settings.preparing") : settings.background ? t("settings.changeImage") : t("settings.chooseImage")}
            </button>
            {settings.background && (
              <button className="btn-ghost" onClick={() => onSave({ ...settings, backgroundDim: dim, background: null })}>
                {t("settings.removeImage")}
              </button>
            )}

            <label className="dim-label" htmlFor="bg-dim">
              {t("settings.dim")} <span className="muted">{Math.round(dim * 100)} %</span>
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
            <p className="hint">{t("settings.dimHint")}</p>
            {error && <div className="error-box">{error}</div>}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.dataDir")}</h2>
        <div className="settings-row">
          <code className="settings-path">{dataDir}</code>
          <button className="btn-ghost" onClick={onChangeDataDir}>
            {t("settings.change")}
          </button>
        </div>
      </section>

      {version && (
        <section className="settings-section">
          <h2>{t("settings.about")}</h2>
          <p className="muted">Todoom v{version}</p>
        </section>
      )}
    </div>
  );
}
