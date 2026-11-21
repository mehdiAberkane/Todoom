import { useEffect, useState } from "react";
import { DEFAULT_KEEP, parseName, type SnapshotInfo } from "../lib/snapshots";
import { prune, restoreSnapshot, takeSnapshot } from "../lib/snapshotter";
import { backend } from "../lib/backend";
import { formatDue } from "../lib/utils";
import { t } from "../lib/i18n";
import { DangerButton } from "./ui";

/** The snapshots of the data folder kept on this computer: how many, made when, and putting one back. */
export function SnapshotsSection({ keep, onKeep, onRestored }: { keep: number | undefined; onKeep: (n: number) => void; onRestored: () => void }) {
  const kept = keep ?? DEFAULT_KEEP;
  const [list, setList] = useState<SnapshotInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const refresh = () =>
    backend
      .listSnapshots()
      .then(setList)
      .catch((e) => setMessage({ text: String(e), error: true }));
  useEffect(() => {
    refresh();
  }, []);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await work() });
    } catch (e) {
      setMessage({ text: t("snapshots.failed", { error: String(e) }), error: true });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const takeNow = () =>
    run(async () => ((await takeSnapshot("manual", kept)) ? t("snapshots.taken") : t("snapshots.pending")));
  const restore = (name: string) =>
    run(async () => {
      const r = await restoreSnapshot(name, kept);
      onRestored();
      return t("snapshots.restored", { written: r.written, removed: r.removed });
    });

  return (
    <section className="settings-section">
      <h2>{t("snapshots.title")}</h2>
      <p className="muted">{t("snapshots.intro")}</p>
      <div className="settings-row">
        <label className="menu-limit snapshots-keep">
          {t("snapshots.keep")}
          <input
            type="number"
            min={1}
            max={365}
            value={kept}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              if (n >= 1 && n <= 365) onKeep(n);
            }}
            onBlur={() => prune(kept).then(refresh)}
          />
        </label>
        <button className="btn-ghost" disabled={busy} onClick={takeNow}>
          {t("snapshots.takeNow")}
        </button>
      </div>
      {message && <p className={message.error ? "check-failed" : "hint"}>{message.text}</p>}
      {list && !list.length && <p className="muted">{t("snapshots.none")}</p>}
      {list && list.length > 0 && (
        <ul className="snapshot-list">
          {list.map((s) => {
            const { kind, day, time } = parseName(s.name);
            return (
              <li key={s.name}>
                <span className="snapshot-date">
                  {formatDue(day)}
                  {time ? ` ${time}` : ""}
                </span>
                <span className="muted">{t(`snapshots.kind.${kind}`)}</span>
                <span className="muted snapshot-size">{Math.max(1, Math.round(s.size / 1024))} Ko</span>
                <DangerButton className="small" onConfirm={() => restore(s.name)} confirmLabel={t("snapshots.restoreQ")} title={t("snapshots.restoreTitle")}>
                  {t("snapshots.restore")}
                </DangerButton>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
