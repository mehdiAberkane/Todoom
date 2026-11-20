// Interface texts in French and English. The English table must have every key of
// the French one (TypeScript checks it), so a missing translation can't ship.
// Placeholders: {name}. Plurals: "<key>_one" / "<key>_other", used through tn().

const fr = {
  // Common
  "common.close": "Fermer",
  "common.closeEsc": "Fermer (Échap)",
  "common.retry": "Réessayer",
  "common.cancel": "Annuler",
  "common.add": "Ajouter",
  "common.create": "Créer",
  "common.restore": "↩ Restaurer",
  "common.reallyQ": "Vraiment ?",
  "common.sureQ": "Sûr ?",
  "common.loading": "Chargement…",

  // Sidebar
  "status.loading": "Chargement…",
  "status.synced": "Synchronisé",
  "status.saving": "Enregistrement…",
  "status.error": "Erreur",
  "status.readError": "Lecture impossible",
  "sidebar.boards": "Tableaux",
  "sidebar.newBoard": "+ Nouveau tableau",
  "sidebar.presenceTitle": "Ces machines ont Todoom ouvert en ce moment",
  "sidebar.alsoOpenOn": "👀 Aussi ouvert sur {hosts}",
  "sidebar.changeDataDir": "Changer de dossier de données",
  "sidebar.trash": "🗑 Corbeille ({n})",
  "sidebar.settings": "⚙ Paramètres",
  "failures.unsaved_one": "⚠ {n} modification non enregistrée",
  "failures.unsaved_other": "⚠ {n} modifications non enregistrées",
  "failures.more": "… et {n} autre(s)",
  "failures.retryIn": "Nouvel essai dans {s} s",
  "issues.buttonTitle": "Fichiers de données que Todoom n'a pas pu charger",
  "issues.count_one": "⚠ {n} fichier ignoré",
  "issues.count_other": "⚠ {n} fichiers ignorés",
  "issues.title": "⚠ Fichiers non chargés",
  "issues.introBefore": "Ces fichiers de",
  "issues.introAfter":
    "n'ont pas pu être chargés. Todoom ne les écrase jamais : répare-les ou supprime-les à la main. Un fichier en cours de synchronisation par Drive peut apparaître ici un instant.",
  "issue.invalid_json": "JSON invalide (fichier partiel ou corrompu)",
  "issue.not_object": "le contenu n'est pas un objet JSON",
  "issue.missing_id": "champ « id » manquant",
  "issue.bad_field": "champ « {field} » de type inattendu",
  "issue.missing_board": "son tableau (board.json) est absent ou illisible",
  "issue.unknown_column": "colonne inconnue : la carte est affichée dans la première colonne",
  "update.available": "⬆ Mettre à jour vers {version}",
  "update.installing": "Installation…",
  "update.failed": "Échec de la mise à jour, réessayer",

  // New board content
  "board.untitled": "Sans nom",
  "default.todo": "À faire",
  "default.doing": "En cours",
  "default.done": "Terminé",
  "default.urgent": "Urgent",
  "default.bug": "Bug",
  "default.idea": "Idée",
  "default.personal": "Perso",

  // Board
  "board.cards_one": "{n} carte",
  "board.cards_other": "{n} cartes",
  "board.overdue": "🔥 {n} en retard",
  "board.search": "🔍 Rechercher…",
  "board.clearFilters": "Effacer",
  "board.labels": "🏷 Étiquettes",
  "board.archives": "📦 Archives",
  "board.archivesTitle": "Cartes archivées : restaurer ou supprimer",
  "board.trash": "🗑 Tableau",
  "board.trashQ": "Mettre à la corbeille ?",
  "board.trashTitle": "Met le tableau à la corbeille : restaurable pendant {days} jours",
  "board.newColumn": "+ Nouvelle colonne",
  "column.deleteQ": "Supprimer ?",
  "column.deleteTitle": "Supprimer la colonne (ses cartes sont archivées)",
  "column.addCard": "+ Ajouter une carte",
  "column.cardTitlePlaceholder": "Titre de la carte… (Entrée pour valider)",
  "card.due": "Échéance",
  "card.checklist": "Checklist",
  "card.hasDescription": "A une description",
  "card.unsaved": "⚠ non enregistrée",
  "card.unsavedTitle": "Le disque n'a pas encore accepté la dernière modification : nouvel essai automatique",

  // Card editor
  "field.title": "Titre",
  "field.description": "Description",
  "field.columnId": "Colonne",
  "field.labels": "Étiquettes",
  "field.due": "Échéance",
  "field.checklist": "Checklist",
  "cardModal.title": "Titre",
  "cardModal.incoming": "↻ Modifiée ailleurs pendant ton édition ({fields}) : ces changements sont repris, les tiens s'appliqueront par-dessus.",
  "cardModal.bothSides": "⚠ Modifié des deux côtés : {fields}. Tu choisiras la version à garder en fermant.",
  "cardModal.descriptionPlaceholder": "Détails, liens, notes…",
  "cardModal.remove": "Retirer",
  "cardModal.addItem": "+ Ajouter un élément",
  "cardModal.manageLabels": "gérer",
  "cardModal.noLabels": "Aucune étiquette",
  "cardModal.today": "Aujourd'hui",
  "cardModal.tomorrow": "Demain",
  "cardModal.nextWeek": "+1 sem.",
  "cardModal.created": "Créée le {date}",
  "cardModal.updated": "Modifiée le {date}",
  "cardModal.archive": "📦 Archiver la carte",
  "cardModal.archiveTitle": "La carte quitte le tableau ; elle reste restaurable depuis les archives",
  "cardModal.save": "Sauvegarder",
  "cardModal.saveTitle": "Enregistre et ferme la carte (Ctrl + Entrée)",
  "conflict.title": "⚠ Cette carte a aussi été modifiée ailleurs",
  "conflict.intro": "Pour chaque champ modifié des deux côtés, choisis la version à garder.",
  "conflict.mine": "Ma version",
  "conflict.theirs": "L'autre version",
  "conflict.back": "Revenir à l'édition",
  "conflict.save": "Enregistrer",
  "conflict.saveArchive": "Enregistrer et archiver",
  "describe.deletedColumn": "colonne supprimée",
  "describe.none": "aucune",
  "describe.empty": "(vide)",
  "describe.checklist": "{n} élément(s), {done} fait(s) : {items}",

  // Archive, trash, labels, empty state
  "archive.title": "📦 Archives de « {name} »",
  "archive.search": "🔍 Rechercher dans les archives…",
  "archive.empty": "Aucune carte archivée. Rien ne se perd, tout se range.",
  "archive.archivedOn": "archivée le {date}",
  "archive.restoreTitle": "Remettre la carte en bas de sa colonne",
  "archive.deleteQ": "Définitivement ?",
  "archive.noMatch": "Aucune carte archivée ne correspond.",
  "trash.title": "🗑 Corbeille",
  "trash.intro": "Les tableaux restent ici {days} jours, avec toutes leurs cartes, puis sont supprimés définitivement.",
  "trash.empty": "La corbeille est vide.",
  "trash.meta": "{cards} · mis à la corbeille le {trashed} · supprimé le {purge}",
  "trash.purge": "Supprimer définitivement",
  "trash.purgeQ": "Supprimer {cards} ?",
  "labels.title": "🏷 Étiquettes de « {name} »",
  "labels.new": "Nouvelle étiquette",
  "labels.color": "Couleur",
  "empty.title": "Aucun tableau.",
  "empty.tagline": "Le doom n'attend que toi.",
  "empty.firstBoard": "Mon premier tableau",
  "empty.create": "Créer mon premier tableau",

  // Setup and settings
  "setup.tagline": "Tes tickets sont condamnés à être finis.",
  "setup.label": "Dossier de données (dans ton Google Drive pour la synchro entre PC)",
  "setup.placeholder": "G:\\Mon Drive\\Todoom",
  "setup.browse": "Parcourir…",
  "setup.hint": "Sur chaque PC, pointe vers le même dossier synchronisé. Sur Mac, c'est en général",
  "setup.macPath": "~/Library/CloudStorage/GoogleDrive-…/Mon Drive/Todoom",
  "setup.go": "C'est parti 🔥",
  "setup.pickTitle": "Où ranger les données Todoom ?",
  "settings.back": "← Retour",
  "settings.language": "Langue",
  "settings.languageAuto": "Automatique (langue du système)",
  "settings.background": "Fond d'écran",
  "settings.backgroundShared": "L'image est enregistrée dans ton dossier Drive : elle s'affiche sur tous tes PC.",
  "settings.backgroundDefault": "Fond noir par défaut",
  "settings.cardPreview": "Aperçu d'une carte",
  "settings.preparing": "Préparation…",
  "settings.changeImage": "Changer d'image…",
  "settings.chooseImage": "Choisir une image…",
  "settings.removeImage": "Retirer l'image",
  "settings.dim": "Assombrissement",
  "settings.dimHint": "Plus c'est sombre, plus les cartes restent lisibles sur une image claire.",
  "settings.dataDir": "Dossier de données",
  "settings.change": "Changer…",
  "settings.about": "À propos",

  // Small pieces and errors
  "ui.renameTitle": "Cliquer pour renommer",
  "emptyCol.1": "Rien ici. Suspect.",
  "emptyCol.2": "Le vide intersidéral.",
  "emptyCol.3": "Zéro tâche, zéro drame.",
  "emptyCol.4": "Calme plat… pour l'instant.",
  "emptyCol.5": "Les tickets dorment ailleurs.",
  "closeGuard.message_one":
    "{n} modification n'a pas pu être enregistrée sur le disque (détails en bas de la barre latérale).\n\nSi tu quittes maintenant, elle sera perdue.",
  "closeGuard.message_other":
    "{n} modifications n'ont pas pu être enregistrées sur le disque (détails en bas de la barre latérale).\n\nSi tu quittes maintenant, elles seront perdues.",
  "closeGuard.quit": "Quitter quand même",
  "closeGuard.stay": "Rester",
  "error.unreadable": "{path} est illisible (JSON invalide) : il n'est pas écrasé. Répare-le ou supprime-le à la main.",
  "error.notImage": "Ce fichier n'est pas une image.",
  "error.badImage": "Image illisible : essaie un JPEG, un PNG ou un WebP.",
  "dev.browserDataDir": "localStorage (mode navigateur)",
  // @end-fr
};

export type Key = keyof typeof fr;

const en: Record<Key, string> = {
  // Common
  "common.close": "Close",
  "common.closeEsc": "Close (Esc)",
  "common.retry": "Retry",
  "common.cancel": "Cancel",
  "common.add": "Add",
  "common.create": "Create",
  "common.restore": "↩ Restore",
  "common.reallyQ": "Really?",
  "common.sureQ": "Sure?",
  "common.loading": "Loading…",

  // Sidebar
  "status.loading": "Loading…",
  "status.synced": "Synced",
  "status.saving": "Saving…",
  "status.error": "Error",
  "status.readError": "Cannot read data",
  "sidebar.boards": "Boards",
  "sidebar.newBoard": "+ New board",
  "sidebar.presenceTitle": "These machines have Todoom open right now",
  "sidebar.alsoOpenOn": "👀 Also open on {hosts}",
  "sidebar.changeDataDir": "Change data folder",
  "sidebar.trash": "🗑 Trash ({n})",
  "sidebar.settings": "⚙ Settings",
  "failures.unsaved_one": "⚠ {n} change not saved",
  "failures.unsaved_other": "⚠ {n} changes not saved",
  "failures.more": "… and {n} more",
  "failures.retryIn": "Retrying in {s} s",
  "issues.buttonTitle": "Data files Todoom could not load",
  "issues.count_one": "⚠ {n} file skipped",
  "issues.count_other": "⚠ {n} files skipped",
  "issues.title": "⚠ Files not loaded",
  "issues.introBefore": "These files in",
  "issues.introAfter":
    "could not be loaded. Todoom never overwrites them: fix or delete them by hand. A file Drive is still syncing may show up here for a moment.",
  "issue.invalid_json": "invalid JSON (partial or corrupted file)",
  "issue.not_object": "the content is not a JSON object",
  "issue.missing_id": "missing \"id\" field",
  "issue.bad_field": "field \"{field}\" has an unexpected type",
  "issue.missing_board": "its board (board.json) is missing or unreadable",
  "issue.unknown_column": "unknown column: the card is shown in the first column",
  "update.available": "⬆ Update to {version}",
  "update.installing": "Installing…",
  "update.failed": "Update failed, retry",

  // New board content
  "board.untitled": "Untitled",
  "default.todo": "To do",
  "default.doing": "In progress",
  "default.done": "Done",
  "default.urgent": "Urgent",
  "default.bug": "Bug",
  "default.idea": "Idea",
  "default.personal": "Personal",

  // Board
  "board.cards_one": "{n} card",
  "board.cards_other": "{n} cards",
  "board.overdue": "🔥 {n} overdue",
  "board.search": "🔍 Search…",
  "board.clearFilters": "Clear",
  "board.labels": "🏷 Labels",
  "board.archives": "📦 Archive",
  "board.archivesTitle": "Archived cards: restore or delete",
  "board.trash": "🗑 Board",
  "board.trashQ": "Move to trash?",
  "board.trashTitle": "Moves the board to the trash: restorable for {days} days",
  "board.newColumn": "+ New column",
  "column.deleteQ": "Delete?",
  "column.deleteTitle": "Delete the column (its cards are archived)",
  "column.addCard": "+ Add a card",
  "column.cardTitlePlaceholder": "Card title… (Enter to add)",
  "card.due": "Due date",
  "card.checklist": "Checklist",
  "card.hasDescription": "Has a description",
  "card.unsaved": "⚠ not saved",
  "card.unsavedTitle": "The disk hasn't accepted the last change yet: retrying automatically",

  // Card editor
  "field.title": "Title",
  "field.description": "Description",
  "field.columnId": "Column",
  "field.labels": "Labels",
  "field.due": "Due date",
  "field.checklist": "Checklist",
  "cardModal.title": "Title",
  "cardModal.incoming": "↻ Changed elsewhere while you were editing ({fields}): those changes are kept, yours apply on top.",
  "cardModal.bothSides": "⚠ Changed on both sides: {fields}. You'll pick which version to keep when closing.",
  "cardModal.descriptionPlaceholder": "Details, links, notes…",
  "cardModal.remove": "Remove",
  "cardModal.addItem": "+ Add an item",
  "cardModal.manageLabels": "manage",
  "cardModal.noLabels": "No labels",
  "cardModal.today": "Today",
  "cardModal.tomorrow": "Tomorrow",
  "cardModal.nextWeek": "+1 week",
  "cardModal.created": "Created {date}",
  "cardModal.updated": "Updated {date}",
  "cardModal.archive": "📦 Archive card",
  "cardModal.archiveTitle": "The card leaves the board; it can be restored from the archive",
  "cardModal.save": "Save",
  "cardModal.saveTitle": "Save and close the card (Ctrl + Enter)",
  "conflict.title": "⚠ This card was also changed elsewhere",
  "conflict.intro": "For each field changed on both sides, pick the version to keep.",
  "conflict.mine": "My version",
  "conflict.theirs": "Other version",
  "conflict.back": "Back to editing",
  "conflict.save": "Save",
  "conflict.saveArchive": "Save and archive",
  "describe.deletedColumn": "deleted column",
  "describe.none": "none",
  "describe.empty": "(empty)",
  "describe.checklist": "{n} item(s), {done} done: {items}",

  // Archive, trash, labels, empty state
  "archive.title": "📦 Archive of \"{name}\"",
  "archive.search": "🔍 Search the archive…",
  "archive.empty": "No archived cards. Nothing is lost, everything is filed away.",
  "archive.archivedOn": "archived {date}",
  "archive.restoreTitle": "Put the card back at the bottom of its column",
  "archive.deleteQ": "For good?",
  "archive.noMatch": "No archived card matches.",
  "trash.title": "🗑 Trash",
  "trash.intro": "Boards stay here for {days} days with all their cards, then are deleted for good.",
  "trash.empty": "The trash is empty.",
  "trash.meta": "{cards} · trashed {trashed} · deleted on {purge}",
  "trash.purge": "Delete for good",
  "trash.purgeQ": "Delete {cards}?",
  "labels.title": "🏷 Labels of \"{name}\"",
  "labels.new": "New label",
  "labels.color": "Colour",
  "empty.title": "No boards.",
  "empty.tagline": "Doom is waiting for you.",
  "empty.firstBoard": "My first board",
  "empty.create": "Create my first board",

  // Setup and settings
  "setup.tagline": "Your tickets are doomed to get done.",
  "setup.label": "Data folder (in your Google Drive to sync between computers)",
  "setup.placeholder": "G:\\My Drive\\Todoom",
  "setup.browse": "Browse…",
  "setup.hint": "On every computer, point to the same synced folder. On a Mac it is usually",
  "setup.macPath": "~/Library/CloudStorage/GoogleDrive-…/My Drive/Todoom",
  "setup.go": "Let's go 🔥",
  "setup.pickTitle": "Where should Todoom keep its data?",
  "settings.back": "← Back",
  "settings.language": "Language",
  "settings.languageAuto": "Automatic (system language)",
  "settings.background": "Background",
  "settings.backgroundShared": "The image is saved in your Drive folder: it shows on all your computers.",
  "settings.backgroundDefault": "Default black background",
  "settings.cardPreview": "Card preview",
  "settings.preparing": "Preparing…",
  "settings.changeImage": "Change image…",
  "settings.chooseImage": "Choose an image…",
  "settings.removeImage": "Remove image",
  "settings.dim": "Darkening",
  "settings.dimHint": "The darker it is, the easier cards are to read over a bright image.",
  "settings.dataDir": "Data folder",
  "settings.change": "Change…",
  "settings.about": "About",

  // Small pieces and errors
  "ui.renameTitle": "Click to rename",
  "emptyCol.1": "Nothing here. Suspicious.",
  "emptyCol.2": "The void of space.",
  "emptyCol.3": "Zero tasks, zero drama.",
  "emptyCol.4": "All quiet… for now.",
  "emptyCol.5": "The tickets are sleeping elsewhere.",
  "closeGuard.message_one":
    "{n} change could not be saved to disk (details at the bottom of the sidebar).\n\nIf you quit now, it will be lost.",
  "closeGuard.message_other":
    "{n} changes could not be saved to disk (details at the bottom of the sidebar).\n\nIf you quit now, they will be lost.",
  "closeGuard.quit": "Quit anyway",
  "closeGuard.stay": "Stay",
  "error.unreadable": "{path} is unreadable (invalid JSON): it is not overwritten. Fix or delete it by hand.",
  "error.notImage": "This file is not an image.",
  "error.badImage": "Unreadable image: try a JPEG, PNG or WebP.",
  "dev.browserDataDir": "localStorage (browser mode)",
  // @end-en
};

export type Lang = "fr" | "en";

/** The system's language when it is French, English otherwise. */
export function systemLang(): Lang {
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

const STORAGE_KEY = "todoom-lang";

// The last language used on this machine, so the start screen (shown before the
// settings are read) is already in the right one.
function remembered(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "fr" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

let current: Lang = remembered() ?? systemLang();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* per-machine convenience only */
  }
}

export const getLang = () => current;

/** Locale for dates and numbers. */
export const locale = () => (current === "fr" ? "fr-FR" : "en-US");

type Params = Record<string, string | number>;

export function t(key: Key, params?: Params): string {
  const text = (current === "fr" ? fr : en)[key];
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];

/** Singular or plural form; French treats 0 and 1 as singular, English only 1. {n} is filled in. */
export function tn(base: PluralBase, n: number, params?: Params): string {
  const one = current === "fr" ? n <= 1 : n === 1;
  return t(`${base}_${one ? "one" : "other"}` as Key, { n, ...params });
}
