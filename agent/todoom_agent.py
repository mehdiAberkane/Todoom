"""Todoom agent: picks up cards moved to "En cours" on one board and runs
Claude Code headless on them, one at a time.

Flow for each card:
  En cours -> Agent (lock, visible in the app) -> À valider (with a summary)

Work happens on a dedicated branch per card. The agent commits but never
pushes and never merges: review the branch, then merge it yourself.

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
from datetime import datetime, timezone
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("config.json")

# Filled from config.json by load_config().
BOARD_DIR = REPO = None
PROJECT = ""
CHECKS = "gofmt, go vet ./... et go test ./..."
BASE_BRANCH = "main"
POLL_SECONDS = 30
TICKET_TIMEOUT = 45 * 60

COL_TRIGGER = "En cours"
COL_LOCK = "Agent"
COL_DONE = "À valider"

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
- Commite ton travail sur la branche courante. Ne pousse pas, ne change pas de branche.
- Si le ticket est flou ou impossible, ne devine pas : n'écris rien et explique pourquoi.
- Termine par un résumé en français de 10 lignes maximum : ce qui est fait,
  ce qui reste, et le résultat des tests.
"""

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
    missing = [n for n in (COL_LOCK, COL_DONE) if n not in names]
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


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().encode("ascii", "ignore").decode()).strip("-")
    return s[:40] or "ticket"


def run_claude(card, branch):
    checklist = "\n".join(f"- [{'x' if i['done'] else ' '}] {i['text']}" for i in card["checklist"])
    details = "\n".join(p for p in (card["description"].strip(), checklist) if p) or "(pas de détail)"
    prompt = PROMPT.format(project=PROJECT, repo=REPO, branch=branch, title=card["title"],
                           details=details, checks=CHECKS)
    cmd = [shutil.which("claude") or "claude", "-p", prompt,
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
    branch = f"agent/{slug(title)}-{card['id'][-6:]}"
    log.info("ticket « %s » -> branche %s", title, branch)

    git("switch", BASE_BRANCH)
    git("switch", "-c", branch)
    try:
        ok, summary = run_claude(card, branch)
    except subprocess.TimeoutExpired:
        ok, summary = False, f"Arrêté après {TICKET_TIMEOUT // 60} minutes."
    commits = git("log", "--oneline", f"{BASE_BRANCH}..{branch}")
    dirty = git("status", "--porcelain", "--untracked-files=no")
    if not dirty:
        git("switch", BASE_BRANCH, check=False)

    status = "OK" if ok else "ÉCHEC"
    report = [f"--- Agent ({status}, {datetime.now():%d/%m %H:%M}) ---",
              f"Branche : {branch}",
              f"Commits : {commits or 'aucun'}"]
    if dirty:
        report.append("Attention : modifications non commitées laissées sur la branche.")
    report += ["", summary or "(pas de résumé)"]
    description = (card["description"].rstrip() + "\n\n" + "\n".join(report)).strip()
    move(card_path, read_json(card_path), cols[COL_DONE], description)
    log.info("ticket « %s » terminé (%s)", title, status)


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
    global BOARD_DIR, REPO, PROJECT, CHECKS, BASE_BRANCH, POLL_SECONDS, TICKET_TIMEOUT
    try:
        cfg = read_json(CONFIG_PATH)
    except FileNotFoundError:
        sys.exit(f"{CONFIG_PATH} introuvable : copiez config.example.json et remplissez-le.")
    BOARD_DIR = Path(cfg["board_dir"])
    REPO = Path(cfg["repo"])
    PROJECT = cfg.get("project", REPO.name)
    CHECKS = cfg.get("checks", CHECKS)
    BASE_BRANCH = cfg.get("base_branch", BASE_BRANCH)
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
