"""Todoom agent: picks up cards moved to "En cours" on one board and runs
Claude Code headless on them, one at a time.

Flow for each card:
  En cours -> Agent (lock, visible in the app) -> A verifier or Echec (with a report)

The report is a comment on the card, signed by this computer and the agent; the
moves go to the card's history. Comments left on the card are given to Claude,
so a remark written there reaches the next attempt.

Work happens on a dedicated branch per card, named <type>/<few-words>. Claude
commits on it; this script then pushes it and opens a merge request on GitLab,
or a pull request on GitHub. Nothing is ever merged here: review and merge it there.

One agent can watch several boards, each with its own repository, checks and
allowed commands. It keeps a status file per board that the app shows.

Settings live in config.json next to this file (see config.example.json).

Usage: python todoom_agent.py [--once | --dry-run]
"""

import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("config.json")

# Settings of the board being handled, set by use() from config.json.
BOARD_DIR = REPO = None
PROJECT = ""
CHECKS = "gofmt, go vet ./... et go test ./..."
BASE_BRANCH = "main"
REMOTE = "origin"
# Commands Claude may run besides git, as in Claude Code's Bash(...) rules.
TOOLS = ["go *", "gofmt *"]
FORGE = "gitlab"
# Every board watched, from config.json.
TARGETS = []

# Settings shared by all the boards.
POLL_SECONDS = 30
TICKET_TIMEOUT = 45 * 60
# Optional command that runs Claude elsewhere (container, other account), e.g.
# ["docker", "run", "--rm", "-v", "{repo}:/work", "-w", "/work", "todoom-agent"].
SANDBOX = []

# Signature of comments and history entries; the history file is <computer>-agent.json.
HOST = socket.gethostname()
AUTHOR = {"host": HOST, "agent": "todoom-agent"}
WRITER = (re.sub(r"[^\w-]", "_", HOST) or "unknown") + "-agent"

COL_TRIGGER = "En cours"
COL_LOCK = "Agent"
COL_DONE = "A verifier"
COL_FAILED = "Echec"

# What Claude may do without asking. Anything else is refused in headless mode.
BASE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep",
              "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)",
              "Bash(git add *)", "Bash(git commit *)"]


def allowed_tools():
    """The base tools, plus the board's own commands (TOOLS), e.g. "npm *" -> Bash(npm *)."""
    return BASE_TOOLS + [f"Bash({t})" for t in TOOLS]
DISALLOWED_TOOLS = ["Bash(git push*)", "Bash(git checkout*)", "Bash(git switch*)",
                    "Bash(git merge*)", "Bash(git reset*)", "Bash(git rebase*)"]

PROMPT = """Tu travailles sur le projet {project} dans {repo}.
Tu es sur la branche git {branch}, créée pour ce ticket. Reste dessus.

{context}Ticket : {title}
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

# Ticket text is untrusted input, and Claude may run `go run` / `go test`, which
# execute any code. Whatever runs under it doesn't inherit tokens, passwords or
# the SSH agent; Claude's own login (ANTHROPIC_*, CLAUDE_*) is kept. Files the
# user can read (~/.ssh, …) stay readable: only SANDBOX removes that.
SECRET_ENV = re.compile(r"TOKEN|SECRET|PASSW|API_?KEY|PRIVATE_KEY|CREDENTIAL|ASKPASS|SSH_AUTH_SOCK|SSH_AGENT"
                        r"|^AWS_|^AZURE_|^GOOGLE_APPLICATION", re.IGNORECASE)
KEEP_ENV = re.compile(r"^(ANTHROPIC_|CLAUDE_)", re.IGNORECASE)

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


def comments_of(card):
    """The card's comments, oldest first (one file each, written by the app, the todoom command or this agent)."""
    folder = BOARD_DIR / "comments" / card["id"]
    comments = []
    for path in folder.glob("*.json") if folder.is_dir() else []:
        try:
            c = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(c, dict) and isinstance(c.get("text"), str):
            comments.append(c)
    return sorted(comments, key=lambda c: c.get("createdAt", ""))


def add_comment(card, text):
    comment = {"id": uid(), "cardId": card["id"], "createdAt": now(), "author": AUTHOR, "text": text}
    path = BOARD_DIR / "comments" / card["id"] / f"{comment['id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, comment)


def record_history(card, events):
    """Appends to this agent's own history file of the card, which nothing else writes."""
    path = BOARD_DIR / "history" / card["id"] / f"{WRITER}.json"
    try:
        earlier = read_json(path).get("events", [])
    except (OSError, json.JSONDecodeError, AttributeError):
        earlier = []
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, {"cardId": card["id"], "writer": WRITER, "events": earlier + events})


def claim_label(c):
    label = " · ".join(p for p in (c.get("host"), c.get("agent")) if p)
    return f"{label} ({c['conversation']})" if c.get("conversation") else label


def held_by_other(card):
    """The card is taken by another computer, agent or conversation: it's theirs, not ours."""
    c = card.get("claimedBy")
    if not isinstance(c, dict):
        return False
    return (c.get("host"), c.get("agent"), c.get("conversation")) != (AUTHOR["host"], AUTHOR["agent"], None)


def set_claim(card, taken):
    """Takes (or releases) the card for this agent; returns the history event, if any."""
    before = card.get("claimedBy")
    after = {**AUTHOR, "at": now()} if taken else None
    card["claimedBy"] = after
    if bool(before) == bool(after):
        return []
    return [{"at": now(), "by": AUTHOR, "field": "claimedBy",
             "from": claim_label(before) if before else None, "to": claim_label(after) if after else None}]


def mr_text(mr):
    return f"{mr['state']} {mr['url']}" if mr else None


def set_dev(card, branch, mr_url):
    """Fills the card's branch and merge request fields; returns the history events."""
    events = []
    if branch and card.get("branch") != branch:
        events.append({"at": now(), "by": AUTHOR, "field": "branch", "from": card.get("branch"), "to": branch})
        card["branch"] = branch
    old = card.get("mergeRequest")
    if mr_url and (old or {}).get("url") != mr_url:
        card["mergeRequest"] = {"url": mr_url, "state": "open"}
        events.append({"at": now(), "by": AUTHOR, "field": "mergeRequest", "from": mr_text(old), "to": mr_text(card["mergeRequest"])})
    return events


def mark_merged():
    """Open merge requests whose branch is now in the base branch are marked merged.

    Called once the local base branch has caught up with the remote, so a request
    merged on GitLab shows as merged in Todoom without anyone touching the card.
    """
    for path in (BOARD_DIR / "cards").glob("*.json"):
        try:
            card = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        mr, branch = card.get("mergeRequest"), card.get("branch")
        if not (isinstance(mr, dict) and mr.get("state") == "open" and branch):
            continue
        if not git("branch", "--merged", BASE_BRANCH, "--list", branch, check=False):
            continue
        card["mergeRequest"] = {**mr, "state": "merged"}
        card["updatedAt"] = now()
        write_json(path, card)
        record_history(card, [{"at": card["updatedAt"], "by": AUTHOR, "field": "mergeRequest",
                               "from": mr_text(mr), "to": mr_text(card["mergeRequest"])}])
        log.info("merge request fusionnée : « %s » (%s)", card.get("title"), branch)


def move(card_path, card, column, cols):
    """Moves the card to the column named `column` (cols: name -> id) and records it."""
    names = {v: k for k, v in cols.items()}
    before = names.get(card.get("columnId"))
    card["columnId"] = cols[column]
    card["order"] = time.time()  # lands at the bottom of the column
    card["updatedAt"] = now()
    write_json(card_path, card)
    if before != column:
        record_history(card, [{"at": card["updatedAt"], "by": AUTHOR, "field": "column", "from": before, "to": column}])


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
        proc = subprocess.run(claude_cmd("-p", prompt, "--model", "haiku"), cwd=REPO, env=claude_env(),
                              capture_output=True, text=True, encoding="utf-8", timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return guess_branch(card)
    name = proc.stdout.strip()
    return name if BRANCH_RE.fullmatch(name) else guess_branch(card)


def branch_exists(name):
    return bool(git("branch", "--list", name) or git("ls-remote", "--heads", REMOTE, name))


def branch_for(card):
    """Reuses the branch of an earlier attempt, named in its report, or picks a new one.

    Reports are comments now; older ones were appended to the description.
    """
    reports = "\n".join([card["description"], *(c["text"] for c in comments_of(card))])
    earlier = re.findall(r"^Branche : (\S+)", reports, re.MULTILINE)
    if earlier and git("branch", "--list", earlier[-1]):
        return earlier[-1]
    name = suggest_branch(card)
    return f"{name}-{card['id'][-6:]}" if branch_exists(name) else name


def push_branch(branch, title):
    """Pushes the branch and opens a merge request (GitLab) or a pull request (GitHub).

    Returns its URL, or the URL to create one, or None when none could be found.
    """
    return push_github(branch, title) if FORGE == "github" else push_gitlab(branch, title)


def push_github(branch, title):
    """Pushes, then opens the pull request with the GitHub CLI (gh), when it is installed."""
    cmd = ["git", "push", "-u", REMOTE, branch]
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode:
        raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
    gh = shutil.which("gh")
    if not gh:
        log.warning("gh (GitHub CLI) introuvable : pull request à ouvrir à la main")
        return None
    pr = subprocess.run([gh, "pr", "create", "--base", BASE_BRANCH, "--head", branch,
                         "--title", " ".join(title.split()), "--body", "Ouverte par l'agent Todoom."],
                        cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    # A pull request that already exists is named, with its address, in the error.
    found = re.search(r"https://\S+/pull/\d+", (pr.stdout or "") + (pr.stderr or ""))
    return found.group(0) if found else None


def push_gitlab(branch, title):
    """Pushes the branch and opens a merge request through GitLab push options."""
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


def claude_cmd(*args):
    """The claude command line, inside SANDBOX when one is configured."""
    if SANDBOX:
        return [part.replace("{repo}", str(REPO)) for part in SANDBOX] + ["claude", *args]
    return [claude_path(), *args]


def claude_env():
    return {k: v for k, v in os.environ.items() if KEEP_ENV.match(k) or not SECRET_ENV.search(k)}


def board_context():
    """The board's context page (written in Todoom), given to Claude before the ticket."""
    try:
        text = (read_json(BOARD_DIR / "board.json").get("description") or "").strip()
    except (OSError, json.JSONDecodeError, AttributeError):
        text = ""
    return f"Contexte du tableau (à respecter) :\n{text}\n\n" if text else ""


def run_claude(card, branch):
    checklist = "\n".join(f"- [{'x' if i['done'] else ' '}] {i['text']}" for i in card["checklist"])
    remarks = "\n\n".join(f"Commentaire ({c.get('author', {}).get('host', '?')}, {c.get('createdAt', '')[:16]}) :\n{c['text']}"
                          for c in comments_of(card))
    details = "\n\n".join(p for p in (card["description"].strip(), checklist, remarks) if p) or "(pas de détail)"
    prompt = PROMPT.format(project=PROJECT, repo=REPO, branch=branch, title=card["title"],
                           details=details, checks=CHECKS, context=board_context())
    cmd = claude_cmd("-p", prompt,
                     "--output-format", "json",
                     "--permission-mode", "acceptEdits",
                     "--allowedTools", *allowed_tools(),
                     "--disallowedTools", *DISALLOWED_TOOLS)
    proc = subprocess.run(cmd, cwd=REPO, env=claude_env(), capture_output=True, text=True,
                          encoding="utf-8", timeout=TICKET_TIMEOUT)
    try:
        out = json.loads(proc.stdout)
        return not out.get("is_error") and proc.returncode == 0, out.get("result", "").strip()
    except json.JSONDecodeError:
        return False, (proc.stderr or proc.stdout).strip()[-2000:]


def update_base():
    """Merge requests are merged on GitLab, so the local base has to catch up first."""
    git("switch", BASE_BRANCH)
    git("fetch", REMOTE, BASE_BRANCH)
    new_commits = git("rev-list", "--count", f"{BASE_BRANCH}..{REMOTE}/{BASE_BRANCH}")
    git("merge", "--ff-only", f"{REMOTE}/{BASE_BRANCH}")
    if new_commits == "0":
        log.info("%s déjà à jour", BASE_BRANCH)
    else:
        log.info("%s mis à jour : %s nouveau(x) commit(s)", BASE_BRANCH, new_commits)
        mark_merged()


def verdict(ok, summary, commits, dirty):
    """No commit or leftover edits means the ticket is not done, even if Claude exited cleanly."""
    if ok and not commits:
        return False, summary or "Aucun commit produit."
    return ok and not dirty, summary


def process(card_path, card, cols):
    title = card["title"]
    if git("status", "--porcelain", "--untracked-files=no"):
        log.warning("dépôt modifié, ticket « %s » laissé en attente", title)
        return
    claim_events = set_claim(card, True)
    move(card_path, card, COL_LOCK, cols)
    write_status("working", card)
    if claim_events:
        record_history(card, claim_events)
    started = time.monotonic()
    log.info("=== NOUVEAU TICKET : « %s »", title)

    branch, commits, dirty, mr_url = "", "", "", None
    try:
        update_base()
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

    ok, summary = verdict(ok, summary, commits, dirty)

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
        forge = "GitHub" if FORGE == "github" else "GitLab"
        report.append(f"Merge request : {mr_url or f'non créée, à ouvrir à la main sur {forge}'}")
    if dirty:
        report.append("Attention : modifications non commitées laissées sur la branche.")
    report += ["", summary or "(pas de résumé)"]
    add_comment(card, "\n".join(report))
    column = COL_DONE if ok else COL_FAILED
    latest = read_json(card_path)
    dev_events = set_dev(latest, branch if branch and git("branch", "--list", branch, check=False) else None,
                         mr_url if pushed else None)
    dev_events += set_claim(latest, False)
    move(card_path, latest, column, cols)
    if dev_events:
        record_history(latest, dev_events)
    minutes, seconds = divmod(int(time.monotonic() - started), 60)
    log.info("=== TICKET TERMINÉ (%s, %d min %02d s) : « %s » -> %s", status, minutes, seconds, title, column)
    if mr_url:
        log.info("    Merge request : %s", mr_url)
    if not ok:
        log.info("    Raison : %s", (summary or "inconnue").splitlines()[0])
    write_status("idle")
    log.info("En attente du prochain ticket...")


STATUS_EVERY = 60
_status = {}


def write_status(state, card=None, force=False):
    """The agent's state for this board, shown in the app: boards/<id>/agents/<computer>-agent.json.

    Written when the state changes, else at most once a minute, so Drive isn't
    kept busy; the app treats a status not refreshed for a while as stopped.
    """
    key = str(BOARD_DIR)
    card_info = {"id": card["id"], "title": card.get("title", "")} if card else None
    last = _status.get(key)
    changed = not last or last["state"] != state or (last["card"] or {}).get("id") != (card_info or {}).get("id")
    if not (force or changed or time.time() - last["written"] >= STATUS_EVERY):
        return
    since = now() if changed else last["since"]
    data = {"host": HOST, "agent": AUTHOR["agent"], "state": state, "card": card_info,
            "since": since, "heartbeat": now(), "pollSeconds": POLL_SECONDS}
    try:
        folder = BOARD_DIR / "agents"
        folder.mkdir(parents=True, exist_ok=True)
        write_json(folder / f"{WRITER}.json", data)
    except OSError as e:
        log.warning("état de l'agent non écrit : %s", e)
        return
    _status[key] = {"state": state, "card": card_info, "since": since, "written": time.time()}


def tick(dry_run=False):
    board_path = BOARD_DIR / "board.json"
    # A board in Todoom's trash is off limits: no ticket is taken from it.
    if read_json(board_path).get("archivedAt"):
        if BOARD_DIR not in tick.trash_logged:
            log.warning("le tableau %s est dans la corbeille de Todoom : aucun ticket n'est pris", BOARD_DIR)
            tick.trash_logged.add(BOARD_DIR)
        return
    tick.trash_logged.discard(BOARD_DIR)
    if not dry_run:
        write_status("idle")
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
        # Archived cards keep their column in Todoom but are off the board.
        if card.get("columnId") == cols[COL_TRIGGER] and not card.get("archivedAt"):
            # Taken by a conversation or another computer: it's being worked on elsewhere.
            if held_by_other(card):
                if card["id"] not in tick.held_logged:
                    log.info("« %s » est pris par %s : laissé", card.get("title"), claim_label(card["claimedBy"]))
                    tick.held_logged.add(card["id"])
                continue
            pending.append((card.get("order", 0), path, card))
    for _, path, card in sorted(pending, key=lambda p: p[0]):
        if dry_run:
            log.info("[dry-run] prendrait « %s »", card["title"])
        else:
            process(path, card, cols)


tick.trash_logged = set()
tick.held_logged = set()


PER_BOARD = ("project", "checks", "base_branch", "remote", "tools", "forge")
DEFAULTS = {"checks": CHECKS, "base_branch": BASE_BRANCH, "remote": REMOTE, "tools": TOOLS, "forge": "auto"}


def strings(value):
    return isinstance(value, list) and all(isinstance(p, str) for p in value)


def make_target(cfg, index):
    """One watched board, its own settings first, then the top-level ones, then the defaults."""
    where = f"tableau n° {index + 1}"
    if not cfg.get("board_dir") or not cfg.get("repo"):
        sys.exit(f"{where} : « board_dir » et « repo » sont obligatoires.")
    t = {**DEFAULTS, **cfg}
    if not strings(t["tools"]):
        sys.exit(f"{where} : « tools » doit être une liste, par exemple [\"npm *\", \"npx *\"].")
    if any("git" == tool.split()[0] for tool in t["tools"] if tool.split()):
        sys.exit(f"{where} : les commandes git sont gérées par l'agent, retire-les de « tools ».")
    if t["forge"] not in ("auto", "gitlab", "github"):
        sys.exit(f"{where} : « forge » vaut auto, gitlab ou github.")
    t["board_dir"], t["repo"] = Path(t["board_dir"]), Path(t["repo"])
    t.setdefault("project", t["repo"].name)
    return t


def use(t):
    """Makes `t` the board being handled."""
    global BOARD_DIR, REPO, PROJECT, CHECKS, BASE_BRANCH, REMOTE, TOOLS, FORGE
    BOARD_DIR, REPO, PROJECT = t["board_dir"], t["repo"], t["project"]
    CHECKS, BASE_BRANCH, REMOTE, TOOLS = t["checks"], t["base_branch"], t["remote"], t["tools"]
    if t["forge"] == "auto":
        # Guessed once from the remote's address.
        url = git("remote", "get-url", REMOTE, check=False) if REPO.is_dir() else ""
        t["forge"] = "github" if "github.com" in url else "gitlab"
    FORGE = t["forge"]


def load_config():
    """config.json holds one board (board_dir, repo… at the top), or several in « boards »."""
    global POLL_SECONDS, TICKET_TIMEOUT, SANDBOX, TARGETS
    try:
        cfg = read_json(CONFIG_PATH)
    except FileNotFoundError:
        sys.exit(f"{CONFIG_PATH} introuvable : copiez config.example.json et remplissez-le.")
    POLL_SECONDS = cfg.get("poll_seconds", POLL_SECONDS)
    TICKET_TIMEOUT = cfg.get("ticket_timeout_minutes", TICKET_TIMEOUT // 60) * 60
    SANDBOX = cfg.get("sandbox", [])
    if not strings(SANDBOX):
        sys.exit("« sandbox » doit être une liste de chaînes, par exemple [\"docker\", \"run\", …].")
    shared = {k: cfg[k] for k in PER_BOARD if k in cfg}
    boards = cfg.get("boards")
    if boards is not None and not (isinstance(boards, list) and boards and all(isinstance(b, dict) for b in boards)):
        sys.exit("« boards » doit être une liste de tableaux : [{\"board_dir\": …, \"repo\": …}, …].")
    TARGETS = [make_target({**shared, **b}, i) for i, b in enumerate(boards or [cfg])]
    use(TARGETS[0])


def main():
    load_config()
    handlers = [logging.FileHandler(Path(__file__).with_name("agent.log"), encoding="utf-8")]
    if sys.stdout:  # None under pythonw
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", handlers=handlers)
    dry_run = "--dry-run" in sys.argv
    once = dry_run or "--once" in sys.argv
    for t in TARGETS:
        use(t)
        log.info("agent démarré, surveille « %s » de %s (%s, %s)", COL_TRIGGER, BOARD_DIR, REPO, FORGE)
    if not SANDBOX:
        log.warning("ATTENTION : Claude s'exécute avec tes droits (fichiers, clés SSH). Un ticket piégé peut "
                    "faire exécuter du code. Voir la section Sécurité de agent/README.md.")
    try:
        while True:
            for t in TARGETS:
                use(t)
                try:
                    tick(dry_run)
                except Exception:
                    log.exception("erreur pendant la surveillance de %s", BOARD_DIR)
            if once:
                break
            time.sleep(POLL_SECONDS)
    finally:
        # Best effort: a killed process can't say it stopped; the app sees its status go stale.
        if not dry_run:
            for t in TARGETS:
                use(t)
                write_status("stopped", force=True)


if __name__ == "__main__":
    main()
