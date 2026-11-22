import { useEffect, useRef, useState } from "react";
import type { AppSettings, Board } from "../types";
import { notifySettings, plain } from "../lib/notify";
import { ensurePermission, notifyPermission, show } from "../lib/notifier";
import { imageToBackground } from "../lib/image";
import { t } from "../lib/i18n";
import { boardSetup, defaultTemplate } from "../lib/templates";
import { THEMES, veilOf, type ThemeChoice } from "../lib/appearance";
import { SnapshotsSection } from "./SnapshotsSection";
import type { InboxIssue } from "../lib/inboxWatcher";
import type { CheckState, UpdateState } from "../lib/updater";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  /** Boards in use, for the names of their columns. */
  boards: Board[];
  /** After a snapshot is restored: read the folder again. */
  onRestored: () => void;
  /** The board the quick capture adds to now. */
  captureBoardId: string | null;
  /** Inbox files that couldn't become cards. */
  inboxIssues: InboxIssue[];
  dataDir: string;
  onChangeDataDir: () => void;
  version: string | null;
  update: UpdateState;
  checkState: CheckState;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onBack: () => void;
}

const SAVE_DELAY_MS = 300;

export function SettingsPage({
  settings,
  onSave,
  boards,
  onRestored,
  captureBoardId,
  inboxIssues,
  dataDir,
  onChangeDataDir,
  version,
  update,
  checkState,
  onCheckUpdate,
  onInstallUpdate,
  onBack,
}: Props) {
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

  // Notifications: the columns of every board, by name, once. A watched name no
  // board uses (« Failed » in French) stays watched but isn't shown.
  const notify = notifySettings(settings);
  const columnNames = (() => {
    const seen = new Map<string, string>();
    for (const b of boards) for (const c of b.columns) if (!seen.has(plain(c.name))) seen.set(plain(c.name), c.name);
    return [...seen.values()];
  })();
  const watched = (name: string) => notify.columns.some((c) => plain(c) === plain(name));
  const saveNotify = (change: Partial<typeof notify>) =>
    onSave({ ...settings, backgroundDim: dim, notifications: { ...notify, ...change } });
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    notifyPermission().then((p) => setDenied(p === "denied")).catch(() => {});
  }, []);
  const test = async () => {
    const ok = await ensurePermission().catch(() => false);
    setDenied(!ok);
    if (ok) await show([{ title: "Todoom", body: t("notify.test") }]);
  };
  const template = defaultTemplate(settings.boardTemplate, boards);

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
        <h2>{t("settings.appearance")}</h2>
        <div className="settings-row">
          <span className="muted">{t("settings.theme")}</span>
          <select
            className="settings-select"
            value={settings.theme ?? "dark"}
            onChange={(e) => onSave({ ...settings, backgroundDim: dim, theme: e.target.value as ThemeChoice })}
          >
            {THEMES.map((th) => (
              <option key={th} value={th}>
                {t(`settings.theme.${th}`)}
              </option>
            ))}
          </select>
        </div>
        <label className="settings-check">
          <input type="checkbox" checked={!!settings.compact} onChange={(e) => onSave({ ...settings, backgroundDim: dim, compact: e.target.checked })} />
          {t("settings.compact")}
        </label>
        <p className="hint">{t("settings.appearanceHint")}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings.boardTemplate")}</h2>
        <select
          className="settings-select"
          value={template}
          onChange={(e) => onSave({ ...settings, backgroundDim: dim, boardTemplate: e.target.value })}
        >
          <option value="simple">{t("tpl.simple")}</option>
          <option value="dev">{t("tpl.dev")}</option>
          {boards.map((b) => (
            <option key={b.id} value={`copy:${b.id}`}>
              {t("tpl.copy", { name: b.name })}
            </option>
          ))}
        </select>
        <p className="hint">{t("settings.boardTemplateColumns", { columns: boardSetup(template, boards).columns.map((c) => c.name).join(" · ") })}</p>
        <p className="hint">{t("settings.boardTemplateHint")}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings.notifications")}</h2>
        <p className="muted">{t("settings.notifyShared")}</p>
        <label className="settings-check">
          <input type="checkbox" checked={notify.enabled} onChange={(e) => saveNotify({ enabled: e.target.checked })} />
          {t("settings.notifyEnabled")}
        </label>
        <div className={`notify-options ${notify.enabled ? "" : "off"}`}>
          <div className="settings-row">
            <span className="muted">{t("settings.notifyColumns")}</span>
            {columnNames.map((name) => (
              <button
                key={name}
                className={`filter-chip ${watched(name) ? "on" : ""}`}
                disabled={!notify.enabled}
                onClick={() =>
                  saveNotify({ columns: watched(name) ? notify.columns.filter((c) => plain(c) !== plain(name)) : [...notify.columns, name] })
                }
              >
                {name}
              </button>
            ))}
          </div>
          <p className="hint">{t("settings.notifyColumnsHint")}</p>
          <label className="settings-check">
            <input type="checkbox" checked={notify.due} disabled={!notify.enabled} onChange={(e) => saveNotify({ due: e.target.checked })} />
            {t("settings.notifyDue")}
          </label>
          <div className="settings-row">
            <button className="btn-ghost" onClick={test} disabled={!notify.enabled}>
              {t("settings.notifyTest")}
            </button>
            {denied && <span className="check-failed">{t("settings.notifyDenied")}</span>}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.background")}</h2>
        <p className="muted">{t("settings.backgroundShared")}</p>

        <div className="bg-editor">
          <div
            className="bg-preview"
            style={
              settings.background
                ? { backgroundImage: `${veilOf(document.documentElement.dataset.theme === "light" ? "light" : "dark", dim)}, url("${settings.background}")` }
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
        <h2>{t("capture.title")}</h2>
        <p className="muted">{t("capture.intro")}</p>
        <div className="settings-row">
          <span className="muted">{t("capture.board")}</span>
          <select
            className="settings-select"
            value={captureBoardId ?? ""}
            onChange={(e) => onSave({ ...settings, backgroundDim: dim, captureBoard: e.target.value })}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("reading.title")}</h2>
        <p className="muted">{t("reading.intro")}</p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={settings.readingCopy !== false}
            onChange={(e) => onSave({ ...settings, backgroundDim: dim, readingCopy: e.target.checked })}
          />
          {t("reading.enabled")}
        </label>
        <p className="muted">{t("inbox.intro", { board: boards.find((b) => b.id === captureBoardId)?.name ?? "—" })}</p>
        <label className="settings-check">
          <input type="checkbox" checked={settings.inbox !== false} onChange={(e) => onSave({ ...settings, backgroundDim: dim, inbox: e.target.checked })} />
          {t("inbox.enabled")}
        </label>
        {inboxIssues.length > 0 && (
          <div className="check-failed">
            {t("inbox.issues")}
            <ul>
              {inboxIssues.map((i) => (
                <li key={i.name}>
                  {i.name} : {t(`inbox.problem.${i.problem}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <SnapshotsSection
        keep={settings.snapshotKeep}
        onKeep={(n) => onSave({ ...settings, backgroundDim: dim, snapshotKeep: n })}
        onRestored={onRestored}
      />

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
          <div className="settings-row">
            {update.kind === "available" ? (
              <button className="btn-primary" onClick={onInstallUpdate}>
                {t("update.available", { version: update.version })}
              </button>
            ) : (
              <button
                className="btn-ghost"
                onClick={onCheckUpdate}
                disabled={checkState.kind === "checking" || update.kind === "installing"}
              >
                {checkState.kind === "checking" ? t("settings.checking") : t("settings.checkNow")}
              </button>
            )}
            {update.kind === "installing" && <span className="muted">{t("update.installing")}</span>}
            {update.kind !== "installing" && checkState.kind === "upToDate" && update.kind !== "available" && (
              <span className="check-ok">{t("settings.upToDate")}</span>
            )}
            {checkState.kind === "failed" && (
              <span className="check-failed" title={checkState.message}>
                {t("settings.checkFailed")}
              </span>
            )}
          </div>
          <p className="hint">{t("settings.checkHint")}</p>
        </section>
      )}
    </div>
  );
}
