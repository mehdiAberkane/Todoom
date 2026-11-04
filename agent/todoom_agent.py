"""Todoom agent: picks up cards moved to "En cours" on one board and runs
Claude Code headless on them, one at a time.

Flow for each card:
  En cours -> Agent (lock, visible in the app) -> A verifier or Echec (with a report)

Work happens on a dedicated branch per card, named <type>/<few-words>. Claude
commits on it; this script then pushes it and opens a merge request on GitLab.
Nothing is ever merged here: review and merge the request on GitLab.

Settings live in config.json next to this file (see config.example.json).

Usage: python todoom_agent.py [--once | --dry-run]
"""

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("config.json")

# Filled from config.json by load_config().
BOARD_DIR = REPO = None
PROJECT = ""
CHECKS = "gofmt, go vet ./... et go test ./..."
BASE_BRANCH = "main"
REMOTE = "origin"
POLL_SECONDS = 30
TICKET_TIMEOUT = 45 * 60

COL_TRIGGER = "En cours"
COL_LOCK = "Agent"
COL_DONE = "A verifier"
COL_FAILED = "Echec"

# What Claude may do without asking. Anything else is refused in headless mode.
ALLOWED_TOOLS = [
    "Read", "Edit", "Write", "Glob", "Grep",
    "Bash(go *)", "Bash(gofmt *)",
    "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)",
    "Bash(git add *)", "Bash(git commit *)",
]
DISALLOWED_TOOLS = ["Bash(git push*)", "Bash(git checkout*)", "Bash(git switch*)",
                    "Bash(git merge*)", "Bash(git reset*)", "Bash(git rebase*)"]

PROMPT = """Tu travailles sur le projet {project} dans {repo}.
Tu es sur la branche git {branch}, créée pour ce ticket. Reste dessus.

Ticket : {title}
{details}

Consignes :
- Fais uniquement ce que demande le ticket, dans le style du code existant.
- Avant de finir, lance : {checks}.
- Commite ton travail sur la branche courante, avec uniquement les fichiers liés au ticket.
- Ne pousse pas et ne change pas de branche : le push et la merge request sont faits après toi.
- Si le ticket est flou ou impossible, ne devine pas : n'écris rien et explique pourquoi.
- Termine par un résumé en français de 10 lignes maximum : ce qui est fait,
  ce qui reste, et le résultat des tests.
"""

NAME_PROMPT = """Donne le nom de la branche git de ce ticket, au format <type>/<mots-avec-tirets>.
Types : feature (nouvelle fonctionnalité), hotfix ou bugfix (correction), security (problème
de sécurité), quality (qualité du code).
Mots : 2 à 4 mots en minuscules, sans accents, séparés par des tirets, qui résument l'action.
Réponds uniquement par le nom de la branche.

Ticket : {title}
{description}
"""

BRANCH_RE = re.compile(r"(feature|hotfix|bugfix|security|quality)/[a-z0-9]+(-[a-z0-9]+)*")
BRANCH_KEYWORDS = [
    ("security", r"\b(securite|security|vuln\w*|cve)\b"),
    ("hotfix", r"\b(hotfix|urgent)\b"),
    ("bugfix", r"\b(bug\w*|bugfix|fix\w*|corrig\w*|correction)\b"),
    ("quality", r"\b(qualite|quality|refacto\w*|nettoy\w*|lint)\b"),
]
STOP_WORDS = {"a", "au", "aux", "avec", "d", "dans", "de", "des", "du", "en", "et", "l", "la",
              "le", "les", "par", "pour", "sur", "un", "une"}

log = logging.getLogger("todoom-agent")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_json(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path, data):
    # Write then rename, so Drive and the app never see a half-written file.
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def uid():
    n, s = int(time.time() * 1000), ""
    while n:
        n, r = divmod(n, 36)
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
    return s + os.urandom(3).hex()


def ensure_columns(board_path):
    """Adds the Agent and À valider columns if the board lacks them."""
    board = read_json(board_path)
    names = {c["name"]: c["id"] for c in board["columns"]}
    missing = [n for n in (COL_LOCK, COL_DONE, COL_FAILED) if n not in names]
    if missing:
        for name in missing:
            col = {"id": uid(), "name": name}
            board["columns"].append(col)
            names[name] = col["id"]
        board["updatedAt"] = now()
        write_json(board_path, board)
        log.info("colonnes ajoutées : %s", ", ".join(missing))
    return names


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                          encoding="utf-8", check=check).stdout.strip()


def move(card_path, card, column_id, description=None):
    card["columnId"] = column_id
    card["order"] = time.time()  # lands at the bottom of the column
    if description is not None:
        card["description"] = description
    card["updatedAt"] = now()
    write_json(card_path, card)


def plain_words(text):
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", ascii_text)


def guess_branch(card):
    """Fallback when Claude cannot name the branch: keywords decide the type."""
    title = " ".join(plain_words(card["title"]))
    kind = next((k for k, pattern in BRANCH_KEYWORDS if re.search(pattern, title)), "feature")
    words = [w for w in plain_words(card["title"]) if w not in STOP_WORDS][:4]
    return f"{kind}/{'-'.join(words) or 'ticket'}"


def suggest_branch(card):
    prompt = NAME_PROMPT.format(title=card["title"], description=card["description"].strip())
    try:
        proc = subprocess.run([claude_path(), "-p", prompt, "--model", "haiku"], cwd=REPO,
                              capture_output=True, text=True, encoding="utf-8", timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return guess_branch(card)
    name = proc.stdout.strip()
    return name if BRANCH_RE.fullmatch(name) else guess_branch(card)


def branch_exists(name):
    return bool(git("branch", "--list", name) or git("ls-remote", "--heads", REMOTE, name))


def branch_for(card):
    """Reuses the branch of an earlier attempt, named in the card's report, or picks a new one."""
    earlier = re.findall(r"^Branche : (\S+)", card["description"], re.MULTILINE)
    if earlier and git("branch", "--list", earlier[-1]):
        return earlier[-1]
    name = suggest_branch(card)
    return f"{name}-{card['id'][-6:]}" if branch_exists(name) else name


def push_branch(branch, title):
    """Pushes the branch and opens a merge request through GitLab push options.

    Returns the merge request URL, or the URL to create one, or None if GitLab gave neither.
    """
    one_line_title = " ".join(title.split())
    cmd = ["git", "push", "-u", REMOTE, branch,
           "-o", "merge_request.create",
           "-o", f"merge_request.target={BASE_BRANCH}",
           "-o", f"merge_request.title={one_line_title}",
           "-o", "merge_request.remove_source_branch"]
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode:
        raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
    urls = re.findall(r"https?://\S+/-/merge_requests/\S+", proc.stderr)
    existing = [u for u in urls if re.search(r"/merge_requests/\d+", u)]
    return (existing or urls or [None])[0]


def claude_path():
    # The native installer puts claude in ~/.local/bin, which is often not on PATH.
    default = Path.home() / ".local" / "bin" / ("claude.exe" if os.name == "nt" else "claude")
    return shutil.which("claude") or (str(default) if default.exists() else "claude")


def run_claude(card, branch):
    checklist = "\n".join(f"- [{'x' if i['done'] else ' '}] {i['text']}" for i in card["checklist"])
    details = "\n".join(p for p in (card["description"].strip(), checklist) if p) or "(pas de détail)"
    prompt = PROMPT.format(project=PROJECT, repo=REPO, branch=branch, title=card["title"],
                           details=details, checks=CHECKS)
    cmd = [claude_path(), "-p", prompt,
           "--output-format", "json",
           "--permission-mode", "acceptEdits",
           "--allowedTools", *ALLOWED_TOOLS,
           "--disallowedTools", *DISALLOWED_TOOLS]
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding="utf-8",
                          timeout=TICKET_TIMEOUT)
    try:
        out = json.loads(proc.stdout)
        return not out.get("is_error") and proc.returncode == 0, out.get("result", "").strip()
    except json.JSONDecodeError:
        return False, (proc.stderr or proc.stdout).strip()[-2000:]


def process(card_path, card, cols):
    title = card["title"]
    if git("status", "--porcelain", "--untracked-files=no"):
        log.warning("dépôt modifié, ticket « %s » laissé en attente", title)
        return
    move(card_path, card, cols[COL_LOCK])

    branch, commits, dirty, mr_url = "", "", "", None
    try:
        # Merge requests are merged on GitLab, so the local base has to catch up first.
        git("fetch", REMOTE, BASE_BRANCH)
        git("switch", BASE_BRANCH)
        git("merge", "--ff-only", f"{REMOTE}/{BASE_BRANCH}")
        branch = branch_for(card)
        log.info("ticket « %s » -> branche %s", title, branch)
        # A failed ticket sent back to En cours resumes on its existing branch.
        git("switch", *([branch] if git("branch", "--list", branch) else ["-c", branch]))
        ok, summary = run_claude(card, branch)
    except subprocess.TimeoutExpired:
        ok, summary = False, f"Arrêté après {TICKET_TIMEOUT // 60} minutes."
    except subprocess.CalledProcessError as e:
        ok, summary = False, f"Erreur git : {(e.stderr or str(e)).strip()}"
    except OSError as e:
        ok, summary = False, f"Impossible de lancer Claude : {e}"
    if branch and git("branch", "--list", branch):
        commits = git("log", "--oneline", f"{BASE_BRANCH}..{branch}", check=False)
    dirty = git("status", "--porcelain", "--untracked-files=no", check=False)
    if not dirty:
        git("switch", BASE_BRANCH, check=False)

    # No commit or leftover edits means the ticket is not done, even if Claude exited cleanly.
    if ok and not commits:
        ok, summary = False, summary or "Aucun commit produit."
    ok = ok and not dirty

    pushed = False
    if ok:
        try:
            mr_url = push_branch(branch, title)
            pushed = True
        except (subprocess.CalledProcessError, OSError) as e:
            ok = False
            error = getattr(e, "stderr", None) or str(e)
            summary = f"Le push a échoué : {error.strip()}\n\n{summary}"

    status = "OK" if ok else "ÉCHEC"
    report = [f"--- Agent ({status}, {datetime.now():%d/%m %H:%M}) ---",
              f"Branche : {branch or 'aucune'}",
              f"Commits : {commits or 'aucun'}"]
    if pushed:
        report.append(f"Merge request : {mr_url or 'non créée, à ouvrir à la main sur GitLab'}")
    if dirty:
        report.append("Attention : modifications non commitées laissées sur la branche.")
    report += ["", summary or "(pas de résumé)"]
    description = (card["description"].rstrip() + "\n\n" + "\n".join(report)).strip()
    column = COL_DONE if ok else COL_FAILED
    move(card_path, read_json(card_path), cols[column], description)
    log.info("ticket « %s » -> %s (%s)", title, column, status)


def tick(dry_run=False):
    board_path = BOARD_DIR / "board.json"
    if dry_run:
        cols = {c["name"]: c["id"] for c in read_json(board_path)["columns"]}
    else:
        cols = ensure_columns(board_path)
    pending = []
    for path in (BOARD_DIR / "cards").glob("*.json"):
        try:
            card = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if card.get("columnId") == cols[COL_TRIGGER]:
            pending.append((card.get("order", 0), path, card))
    for _, path, card in sorted(pending, key=lambda p: p[0]):
        if dry_run:
            log.info("[dry-run] prendrait « %s »", card["title"])
        else:
            process(path, card, cols)


def load_config():
    global BOARD_DIR, REPO, PROJECT, CHECKS, BASE_BRANCH, REMOTE, POLL_SECONDS, TICKET_TIMEOUT
    try:
        cfg = read_json(CONFIG_PATH)
    except FileNotFoundError:
        sys.exit(f"{CONFIG_PATH} introuvable : copiez config.example.json et remplissez-le.")
    BOARD_DIR = Path(cfg["board_dir"])
    REPO = Path(cfg["repo"])
    PROJECT = cfg.get("project", REPO.name)
    CHECKS = cfg.get("checks", CHECKS)
    BASE_BRANCH = cfg.get("base_branch", BASE_BRANCH)
    REMOTE = cfg.get("remote", REMOTE)
    POLL_SECONDS = cfg.get("poll_seconds", POLL_SECONDS)
    TICKET_TIMEOUT = cfg.get("ticket_timeout_minutes", TICKET_TIMEOUT // 60) * 60


def main():
    load_config()
    handlers = [logging.FileHandler(Path(__file__).with_name("agent.log"), encoding="utf-8")]
    if sys.stdout:  # None under pythonw
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", handlers=handlers)
    dry_run = "--dry-run" in sys.argv
    once = dry_run or "--once" in sys.argv
    log.info("agent démarré, surveille « %s » de %s", COL_TRIGGER, BOARD_DIR)
    while True:
        try:
            tick(dry_run)
        except Exception:
            log.exception("erreur pendant la surveillance")
        if once:
            break
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
