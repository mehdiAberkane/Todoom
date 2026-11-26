import { useEffect, useRef, useState } from "react";
import type { Board, Card } from "../types";
import { addDays, dueStatus, formatDateTime, formatDue, now, uid } from "../lib/utils";
import { conflicts, mergeEdits, rebase, type Field } from "../lib/merge";
import { t } from "../lib/i18n";
import { priorityOf, prioritiesOf } from "../lib/priority";

const fieldLabel = (f: Field) => t(`field.${f}`);
import { Modal } from "./ui";
import { LinkSection, Mentions, type LinkProps } from "./LinkSection";
import { ActivitySection, type ActivityProps } from "./ActivitySection";
import { MarkdownView } from "./Markdown";
import { toggleTask } from "../lib/markdown";
import { applyTemplate, CARD_TEMPLATES } from "../lib/templates";
import { AttachmentsSection, filesOf, type AttachmentProps } from "./AttachmentsSection";
import { branchName, branchUrl, MR_STATES, webUrl } from "../lib/dev";
import { CARD_COLORS, toISODate } from "../lib/utils";
import { isAsleep, nextDue, REPEATS, type Repeat } from "../lib/recurring";
import { claimLabel } from "../lib/claim";
import { checklistDone, isFinished } from "../lib/links";
import { refOf } from "../lib/shortid";
import { openExternal } from "../lib/open";
import { datesOf, formatDuration, staysOf, timeByColumn } from "../lib/timeline";
import type { MergeRequestState } from "../types";
import { mayMoveOnMerge, mergeSetting } from "../lib/reviewWatch";

interface Props {
  card: Card;
  board: Board;
  onSave: (card: Card) => void;
  onClose: () => void;
  onManageLabels: () => void;
  /** A card not on the board yet: closing without typing anything creates nothing. */
  isNew?: boolean;
  /** Links to other cards; left out for a card not saved yet. */
  links?: LinkProps;
  /** Short id such as SOL-42. */
  cardRef?: string | null;
  /** Comments and history; left out for a card not saved yet. */
  activity?: ActivityProps;
  /** Take or release the card; left out for a card not saved yet. Written right away, like links. */
  claim?: { onTake: () => void; onRelease: () => void };
  /** For an archived card: puts it back on the board. */
  onRestore?: () => void;
  /** Files attached to the card; left out for a card not saved yet. */
  attachments?: AttachmentProps;
  /** Makes a card of a checklist item's text, which this card then depends on. */
  onItemToCard?: (text: string) => Card;
  /** Copy and move; left out for a card not saved yet. They get the card with the edits made here. */
  transfer?: {
    boards: Board[];
    onDuplicate: (current: Card) => void;
    onMoveToBoard: (current: Card, boardId: string, columnId: string) => Promise<void>;
  };
}

/**
 * Edits a draft and saves once on close, so typing doesn't rewrite the file on
 * every keystroke. `card` follows reloads while the window is open: only the
 * fields edited here are written over it, so changes made elsewhere (another
 * PC, the agent) are kept.
 */
export function CardModal({ card, board, onSave, onClose, onManageLabels, isNew = false, links, cardRef, activity, claim, onRestore, attachments, onItemToCard, transfer }: Props) {
  // The version the edits started from, moved forward as outside changes come in.
  const [base, setBase] = useState(card);
  const [draft, setDraft] = useState(card);
  // The description is read as Markdown; it is edited as text when empty, or on demand.
  const [editingDesc, setEditingDesc] = useState(() => !card.description.trim());
  // The card as it would be saved now: what a copy or a move takes.
  const current = () => mergeEdits(base, cleaned(), card) ?? card;
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState<{ boardId: string; columnId: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const otherBoards = transfer?.boards.filter((b) => b.id !== board.id && !b.archivedAt) ?? [];
  const targetBoard = otherBoards.find((b) => b.id === moveTo?.boardId);
  const pickBoard = (boardId: string) => {
    const b = otherBoards.find((x) => x.id === boardId);
    setMoveTo(b ? { boardId: b.id, columnId: b.columns[0]?.id ?? "" } : null);
  };
  const doMove = async () => {
    if (!transfer || !moveTo?.columnId) return;
    setMoveError(null);
    try {
      await transfer.onMoveToBoard(current(), moveTo.boardId, moveTo.columnId);
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : String(e));
    }
  };

  // Files pasted, dropped or picked are attached right away, like comments.
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const attach = (files: File[]) => {
    if (!attachments) return;
    setAttachError(null);
    for (const file of files) attachments.onAdd(file).catch((e) => setAttachError(e instanceof Error ? e.message : String(e)));
  };
  const [incoming, setIncoming] = useState<Field[]>([]);
  const [resolving, setResolving] = useState<{ fields: Field[]; archive: boolean } | null>(null);
  const [keepTheirs, setKeepTheirs] = useState<Set<Field>>(new Set());
  const [newItem, setNewItem] = useState("");
  const set = (patch: Partial<Card>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    const r = rebase(base, draft, card);
    if (!r.incoming.length) return;
    setBase(r.base);
    setDraft(r.draft);
    setIncoming((prev) => [...new Set([...prev, ...r.incoming])]);
  }, [card]); // eslint-disable-line react-hooks/exhaustive-deps

  // A merge request whose address isn't a web address is dropped rather than saved.
  const cleaned = () => ({
    ...draft,
    title: draft.title.trim() || base.title || t("cardModal.untitled"),
    branch: draft.branch?.trim() || null,
    mergeRequest: draft.mergeRequest && webUrl(draft.mergeRequest.url) ? { ...draft.mergeRequest, url: webUrl(draft.mergeRequest.url)! } : null,
  });
  const mrUrlOk = !draft.mergeRequest?.url.trim() || !!webUrl(draft.mergeRequest.url);
  // The name a branch for this card gets (board format), offered while the field is empty.
  const suggestedBranch = branchName(draft, board);
  const branchLink = branchUrl(draft.branch, draft.mergeRequest && webUrl(draft.mergeRequest.url) ? draft.mergeRequest : null);
  const pending = conflicts(base, cleaned(), card);

  const finish = (archive: boolean, theirs: ReadonlySet<Field>) => {
    // A new card only exists once something was put in it; picking a column alone isn't enough.
    const empty = isNew && !mergeEdits(base, { ...draft, columnId: base.columnId }, card, theirs);
    const merged = empty ? null : mergeEdits(base, cleaned(), card, theirs);
    if (archive) onSave({ ...(merged ?? card), archivedAt: now() });
    else if (merged) onSave(merged);
    onClose();
  };

  // Asks which version to keep when a field was also changed elsewhere.
  const leave = (archive: boolean) => {
    if (pending.length) {
      setKeepTheirs(new Set());
      setResolving({ fields: pending, archive });
    } else {
      finish(archive, new Set());
    }
  };
  const close = () => leave(false);
  // Saves this card on the way to the linked one; if a field needs a choice, stays here.
  const openLinked = (boardId: string, cardId: string) => {
    if (pending.length) return close();
    finish(false, new Set());
    links?.onOpen(boardId, cardId);
  };
  // Ctrl + Enter (Cmd + Enter on a Mac) saves from any field, like the button.
  const closeRef = useRef<(() => void) | null>(close);
  closeRef.current = resolving ? null : close; // not while choosing between versions
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !closeRef.current) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Keeps any pending edits; archiving is reversible, so no confirmation.
  const archive = () => leave(true);

  const toggleLabel = (id: string) =>
    set({ labels: draft.labels.includes(id) ? draft.labels.filter((l) => l !== id) : [...draft.labels, id] });

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    set({ checklist: [...draft.checklist, { id: uid(), text, done: false }] });
    setNewItem("");
  };

  const updateItem = (id: string, patch: { text?: string; done?: boolean; cardId?: string }) =>
    set({ checklist: draft.checklist.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  const done = links ? checklistDone(draft, links.index) : draft.checklist.filter((i) => i.done).length;
  const total = draft.checklist.length;
  const due = dueStatus(draft.due);

  if (resolving) {
    const choose = (f: Field, theirs: boolean) =>
      setKeepTheirs((s) => {
        const next = new Set(s);
        if (theirs) next.add(f);
        else next.delete(f);
        return next;
      });
    return (
      <Modal onClose={() => setResolving(null)} className="conflict-modal">
        <div className="modal-head">
          <h3>{t("conflict.title")}</h3>
        </div>
        <p className="muted">{t("conflict.intro")}</p>
        {resolving.fields.map((f) => (
          <div key={f} className="conflict">
            <h4>{fieldLabel(f)}</h4>
            <label className={!keepTheirs.has(f) ? "on" : ""}>
              <input type="radio" checked={!keepTheirs.has(f)} onChange={() => choose(f, false)} />
              <span className="conflict-who">{t("conflict.mine")}</span>
              <span className="conflict-value">{describe(f, cleaned(), board)}</span>
            </label>
            <label className={keepTheirs.has(f) ? "on" : ""}>
              <input type="radio" checked={keepTheirs.has(f)} onChange={() => choose(f, true)} />
              <span className="conflict-who">{t("conflict.theirs")}</span>
              <span className="conflict-value">{describe(f, card, board)}</span>
            </label>
          </div>
        ))}
        <div className="conflict-actions">
          <button className="btn-ghost" onClick={() => setResolving(null)}>
            {t("conflict.back")}
          </button>
          <button className="btn-primary" onClick={() => finish(resolving.archive, keepTheirs)}>
            {resolving.archive ? t("conflict.saveArchive") : t("conflict.save")}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={close} className={`card-modal ${dropping ? "dropping" : ""}`}>
      <div
        className="drop-area"
        onPaste={(e) => {
          const files = filesOf(e.clipboardData);
          if (!attachments || !files.length) return;
          e.preventDefault();
          attach(files);
        }}
        onDragOver={(e) => {
          if (!attachments || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
        onDrop={(e) => {
          if (!attachments) return;
          e.preventDefault();
          setDropping(false);
          attach(filesOf(e.dataTransfer));
        }}
      >
      <div className="modal-head">
        {cardRef && <CopyRef value={cardRef} />}
        <textarea
          className="modal-title"
          rows={1}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })}
          placeholder={t("cardModal.title")}
          autoFocus={isNew}
        />
        <button className="icon-btn" onClick={close} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>

      {card.archivedAt && (
        <div className="archived-banner">
          {t("cardModal.archivedBanner", { date: formatDateTime(card.archivedAt) })}
          {onRestore && (
            <button className="btn-primary small" onClick={onRestore}>
              {t("cardModal.restore")}
            </button>
          )}
        </div>
      )}

      {(incoming.length > 0 || pending.length > 0) && (
        <div className="external-banner">
          {incoming.length > 0 && (
            <div>
              {t("cardModal.incoming", { fields: incoming.map(fieldLabel).join(", ") })}
            </div>
          )}
          {pending.length > 0 && (
            <div className="external-conflict">
              {t("cardModal.bothSides", { fields: pending.map(fieldLabel).join(", ") })}
            </div>
          )}
        </div>
      )}

      <div className="modal-body">
        <div className="modal-main">
          {isNew && (
            <div className="card-templates" title={t("tpl.cardTitle")}>
              <span className="muted">{t("tpl.cardLabel")}</span>
              {CARD_TEMPLATES.map((tpl) => (
                <button
                  key={tpl}
                  className="filter-chip"
                  onClick={() => {
                    setDraft((d) => applyTemplate(d, tpl, board));
                    setEditingDesc(true);
                  }}
                >
                  {t(`tpl.cardName.${tpl}`)}
                </button>
              ))}
            </div>
          )}
          <h4>
            {t("field.description")}
            {draft.description.trim() && (
              <button className="link md-toggle" onClick={() => setEditingDesc((v) => !v)}>
                {editingDesc ? t("md.preview") : t("md.edit")}
              </button>
            )}
          </h4>
          {editingDesc ? (
            <>
              <textarea
                className="description"
                rows={6}
                placeholder={t("cardModal.descriptionPlaceholder")}
                value={draft.description}
                autoFocus={!!draft.description.trim()}
                onChange={(e) => set({ description: e.target.value })}
                onBlur={(e) => {
                  // Back to reading once written, unless the click was on the toggle itself.
                  if (draft.description.trim() && !(e.relatedTarget as HTMLElement | null)?.closest(".md-toggle")) setEditingDesc(false);
                }}
              />
              <div className="md-hint muted">{t("md.hint")}</div>
            </>
          ) : (
            <MarkdownView
              text={draft.description}
              onEdit={() => setEditingDesc(true)}
              onToggleTask={(line) => set({ description: toggleTask(draft.description, line) })}
            />
          )}
          {links && <Mentions text={draft.description} selfId={card.id} index={links.index} onOpen={openLinked} />}

          <h4>
            {t("field.checklist")} {total > 0 && <span className="muted">{done}/{total}</span>}
          </h4>
          {total > 0 && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
          <ul className="checklist">
            {draft.checklist.map((item) => {
              // An item turned into a card follows that card: ticked once it is finished.
              const linked = item.cardId ? links?.index.get(item.cardId) : undefined;
              const done = linked ? isFinished(linked.card, linked.board) : item.done;
              return (
              <li key={item.id} className={done ? "done" : ""}>
                <input
                  type="checkbox"
                  checked={done}
                  disabled={!!item.cardId}
                  onChange={(e) => updateItem(item.id, { done: e.target.checked })}
                />
                <input className="check-text" value={item.text} onChange={(e) => updateItem(item.id, { text: e.target.value })} />
                {item.cardId ? (
                  linked ? (
                    <button className="link item-card" onClick={() => openLinked(linked.board.id, linked.card.id)} title={t("checklist.open")}>
                      {refOf(linked.board, linked.card) ?? "↗"} · {linked.board.columns.find((c) => c.id === linked.card.columnId)?.name ?? "—"}
                    </button>
                  ) : (
                    <span className="muted item-card">{t("checklist.cardGone")}</span>
                  )
                ) : (
                  onItemToCard &&
                  item.text.trim() && (
                    <button
                      className="icon-btn"
                      title={t("checklist.toCard")}
                      onClick={() => {
                        const made = onItemToCard(item.text.trim());
                        updateItem(item.id, { cardId: made.id });
                      }}
                    >
                      ↗
                    </button>
                  )
                )}
                <button
                  className="icon-btn"
                  title={t("cardModal.remove")}
                  onClick={() => set({ checklist: draft.checklist.filter((i) => i.id !== item.id) })}
                >
                  ✕
                </button>
              </li>
              );
            })}
          </ul>
          <div className="check-add">
            <input
              placeholder={t("cardModal.addItem")}
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
          </div>

          {links && <LinkSection card={card} {...links} onOpen={openLinked} />}
          {attachments && <AttachmentsSection {...attachments} onAdd={async (file) => attach([file])} error={attachError} />}
          {activity && <ActivitySection {...activity} />}
        </div>

        <aside className="modal-side">
          {claim && (
            <>
              <h4>{t("field.claimedBy")}</h4>
              <div className="claim-row">
                {card.claimedBy ? (
                  <span className="claim-who" title={t("claim.since", { date: formatDateTime(card.claimedBy.at) })}>
                    👤 {claimLabel(card.claimedBy)}
                  </span>
                ) : (
                  <span className="muted">{t("claim.nobody")}</span>
                )}
                {card.claimedBy ? (
                  <button className="btn-ghost small" onClick={claim.onRelease} title={t("claim.releaseTitle")}>
                    {t("claim.release")}
                  </button>
                ) : (
                  <button className="btn-ghost small" onClick={claim.onTake} title={t("claim.takeTitle")}>
                    {t("claim.take")}
                  </button>
                )}
              </div>
            </>
          )}
          <h4>{t("field.columnId")}</h4>
          <select value={draft.columnId} onChange={(e) => set({ columnId: e.target.value })}>
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <h4>
            {t("field.priority")}
            <button className="link" onClick={onManageLabels}>
              {t("cardModal.manageLabels")}
            </button>
          </h4>
          <div className="label-picker">
            {prioritiesOf(board).map((p) => (
              <button
                key={p.id}
                className={`filter-chip priority-chip ${draft.priority === p.id ? "on" : ""}`}
                style={{ "--chip": p.color } as React.CSSProperties}
                onClick={() => set({ priority: draft.priority === p.id ? null : p.id })}
              >
                {p.name}
              </button>
            ))}
          </div>

          <h4>
            {t("field.labels")}
            <button className="link" onClick={onManageLabels}>
              {t("cardModal.manageLabels")}
            </button>
          </h4>
          <div className="label-picker">
            {board.labels.map((l) => (
              <button
                key={l.id}
                className={`filter-chip ${draft.labels.includes(l.id) ? "on" : ""}`}
                style={{ "--chip": l.color } as React.CSSProperties}
                onClick={() => toggleLabel(l.id)}
              >
                {l.name}
              </button>
            ))}
            {board.labels.length === 0 && <span className="muted">{t("cardModal.noLabels")}</span>}
          </div>

          <h4>{t("field.color")}</h4>
          <div className="card-colors">
            <button
              className={`swatch none ${draft.color ? "" : "on"}`}
              onClick={() => set({ color: null })}
              title={t(board.colorByPriority !== false ? "cardModal.priorityColor" : "cardModal.noColor")}
            />
            {CARD_COLORS.map((c) => (
              <button key={c} className={`swatch ${draft.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} />
            ))}
          </div>

          <h4>{t("field.due")}</h4>
          <input
            type="date"
            className={due ? `due-${due}` : ""}
            value={draft.due ?? ""}
            onChange={(e) => set({ due: e.target.value || null })}
          />
          <div className="due-shortcuts">
            <button className="btn-ghost small" onClick={() => set({ due: addDays(0) })}>{t("cardModal.today")}</button>
            <button className="btn-ghost small" onClick={() => set({ due: addDays(1) })}>{t("cardModal.tomorrow")}</button>
            <button className="btn-ghost small" onClick={() => set({ due: addDays(7) })}>{t("cardModal.nextWeek")}</button>
            {draft.due && (
              <button className="btn-ghost small" onClick={() => set({ due: null })}>{t("cardModal.remove")}</button>
            )}
          </div>

          <h4>{t("field.repeat")}</h4>
          <select
            className="repeat-select"
            value={draft.repeat?.every ?? ""}
            onChange={(e) => set({ repeat: e.target.value ? { every: e.target.value as Repeat["every"] } : null })}
          >
            <option value="">{t("repeat.never")}</option>
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {t(`repeat.${r}`)}
              </option>
            ))}
          </select>
          {draft.repeat && (
            <p className="hint">{t("repeat.hint", { date: formatDue(nextDue(draft.due, draft.repeat, toISODate(new Date()))) })}</p>
          )}
          {isAsleep(card, toISODate(new Date())) && (
            <p className="hint routine-waiting">
              {t("repeat.waiting", { date: formatDue(card.wakeOn!), column: board.columns[0]?.name ?? "" })}{" "}
              <button className="link" onClick={() => onSave({ ...card, wakeOn: null })}>
                {t("repeat.wakeNow")}
              </button>
            </p>
          )}

          <h4>{t("field.branch")}</h4>
          <div className="git-row">
            <input
              value={draft.branch ?? ""}
              placeholder={suggestedBranch}
              spellCheck={false}
              onChange={(e) => set({ branch: e.target.value || null })}
            />
            {draft.branch?.trim() ? (
              <CopyButton value={`git switch -c ${draft.branch.trim()}`} title={t("git.copyCommand")} />
            ) : (
              <button className="icon-btn" onClick={() => set({ branch: suggestedBranch })} title={t("git.useSuggested", { name: suggestedBranch })}>
                ↵
              </button>
            )}
            {branchLink && (
              <button className="icon-btn" onClick={() => openExternal(branchLink)} title={t("git.open")}>
                ↗
              </button>
            )}
          </div>

          <h4>{t("field.mergeRequest")}</h4>
          <div className="git-row">
            <input
              className={mrUrlOk ? "" : "invalid"}
              value={draft.mergeRequest?.url ?? ""}
              placeholder={t("git.mrPlaceholder")}
              spellCheck={false}
              title={mrUrlOk ? undefined : t("git.mrInvalid")}
              onChange={(e) =>
                set({ mergeRequest: e.target.value ? { url: e.target.value, state: draft.mergeRequest?.state ?? "open" } : null })
              }
            />
            {draft.mergeRequest && mrUrlOk && (
              <button className="icon-btn" onClick={() => openExternal(draft.mergeRequest!.url)} title={t("git.open")}>
                ↗
              </button>
            )}
          </div>
          {draft.mergeRequest && (
            <select
              className={`mr-state mr-${draft.mergeRequest.state}`}
              value={draft.mergeRequest.state}
              onChange={(e) => set({ mergeRequest: { ...draft.mergeRequest!, state: e.target.value as MergeRequestState } })}
            >
              {MR_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`mr.${s}`)}
                </option>
              ))}
            </select>
          )}
          <MergedMove card={draft} board={board} onMove={(columnId) => set({ columnId })} />

          {activity && <Tracking card={card} board={board} history={activity.history} />}

          <div className="meta">
            <div>{t("cardModal.created", { date: formatDateTime(card.createdAt) })}</div>
            {card.updatedAt && <div>{t("cardModal.updated", { date: formatDateTime(card.updatedAt) })}</div>}
          </div>

          {transfer && !card.archivedAt && (
            <div className="transfer">
              <button
                className="btn-ghost full"
                title={t("transfer.duplicateTitle")}
                onClick={() => {
                  const now = current();
                  finish(false, new Set());
                  transfer.onDuplicate(now);
                }}
              >
                {t("transfer.duplicate")}
              </button>
              {otherBoards.length > 0 && (
                <button className="btn-ghost full" onClick={() => (setMoving((m) => !m), pickBoard(otherBoards[0].id))}>
                  {t("transfer.move")}
                </button>
              )}
              {moving && moveTo && (
                <div className="transfer-form">
                  <label>
                    {t("transfer.board")}
                    <select value={moveTo.boardId} onChange={(e) => pickBoard(e.target.value)}>
                      {otherBoards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("transfer.column")}
                    <select value={moveTo.columnId} onChange={(e) => setMoveTo({ ...moveTo, columnId: e.target.value })}>
                      {targetBoard?.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">{t("transfer.hint")}</p>
                  {moveError && <div className="error-box">{moveError}</div>}
                  <button className="btn-primary small" onClick={doMove} disabled={!moveTo.columnId}>
                    {t("transfer.go")}
                  </button>
                </div>
              )}
            </div>
          )}
          {!isNew && !card.archivedAt && (
            <button className="btn-ghost full" onClick={archive} title={t("cardModal.archiveTitle")}>
              {t("cardModal.archive")}
            </button>
          )}
        </aside>
      </div>

      <div className="modal-foot">
        <button className="btn-primary" onClick={close} title={t("cardModal.saveTitle")}>
          {t("cardModal.save")}
        </button>
      </div>
      </div>
    </Modal>
  );
}

/** Copies text; false when neither the clipboard API nor the older copy command works. */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Some webviews refuse the clipboard API; the older copy command still works there.
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** "Copied" for a moment after a successful copy. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (value: string) => {
    if (!(await copyText(value))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return { copied, copy };
}

/** A small button that copies a command, e.g. the one creating the card's branch. */
function CopyButton({ value, title }: { value: string; title: string }) {
  const { copied, copy } = useCopy();
  return (
    <button className="icon-btn" onClick={() => copy(value)} title={`${title}\n${value}`}>
      {copied ? "✓" : "⧉"}
    </button>
  );
}

/** The card's short id; a click copies it, to paste in a commit, a merge request or another ticket. */
function CopyRef({ value }: { value: string }) {
  const { copied, copy: copyValue } = useCopy();
  const copy = () => copyValue(value);
  return (
    <button className="card-ref-chip" onClick={copy} title={t("card.copyRef")}>
      {copied ? `✓ ${t("card.copied")}` : value}
    </button>
  );
}

/** One-line, human-readable value of a field, for the conflict choice. */
function describe(field: Field, card: Card, board: Board): string {
  switch (field) {
    case "columnId":
      return board.columns.find((c) => c.id === card.columnId)?.name ?? t("describe.deletedColumn");
    case "labels":
      return card.labels.map((id) => board.labels.find((l) => l.id === id)?.name).filter(Boolean).join(", ") || t("describe.none");
    case "due":
      return card.due ? formatDue(card.due) : t("describe.none");
    case "priority":
      return priorityOf(board, card)?.name ?? t("describe.none");
    case "branch":
      return card.branch ?? t("describe.none");
    case "color":
      return card.color ?? t("describe.none");
    case "repeat":
      return card.repeat ? t(`repeat.${card.repeat.every}`) : t("repeat.never");
    case "mergeRequest":
      return card.mergeRequest ? `${card.mergeRequest.url} (${t(`mr.${card.mergeRequest.state}`)})` : t("describe.none");
    case "checklist": {
      const done = card.checklist.filter((i) => i.done).length;
      return t("describe.checklist", { n: card.checklist.length, done, items: card.checklist.map((i) => i.text).join(" · ") });
    }
    default: {
      const text = card[field].trim();
      return text ? (text.length > 280 ? `${text.slice(0, 280)}…` : text) : t("describe.empty");
    }
  }
}

/** Start and end dates and time per column, read from the card's history. */
function Tracking({ card, board, history }: { card: Card; board: Board; history: ActivityProps["history"] }) {
  const stays = staysOf(card, board, history);
  const { started, finished } = datesOf(card, board, stays);
  const times = timeByColumn(card, stays);
  const current = stays[stays.length - 1];
  return (
    <div className="tracking">
      <h4>{t("tracking.title")}</h4>
      <div>
        {started ? t("tracking.started", { date: formatDateTime(started) }) : <span className="muted">{t("tracking.notStarted")}</span>}
      </div>
      {finished && (
        <div>
          {t("tracking.finished", { date: formatDateTime(finished) })}
          <span className="muted"> · {t("tracking.took", { time: formatDuration(Date.parse(finished) - Date.parse(started ?? card.createdAt)) })}</span>
        </div>
      )}
      {times.length > 0 && (
        <ul className="time-columns" title={t("tracking.timeTitle")}>
          {times.map(({ column, ms }) => (
            <li key={column} className={column === current?.column && !current.guessed && !card.archivedAt ? "now" : ""}>
              <span>{column}</span>
              <span>{formatDuration(ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Its PR/MR merged, the card not yet where its board sends merged ones: « Move to A verifier » (TOD-69). */
function MergedMove({ card, board, onMove }: { card: Card; board: Board; onMove: (columnId: string) => void }) {
  const { action, column } = mergeSetting(board);
  if (card.mergeRequest?.state !== "merged" || action === "none" || !mayMoveOnMerge(card, board, column)) return null;
  return (
    <button className="btn-ghost small merged-move" onClick={() => onMove(column.id)} title={t("cardModal.mergedMoveTitle")}>
      {t("prPopup.moveTo", { column: column.name })}
    </button>
  );
}
