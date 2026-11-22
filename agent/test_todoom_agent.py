"""Tests for what the agent hands to Claude. Run: python -m unittest discover -s agent"""

import os
import time
import unittest
from pathlib import Path
from unittest import mock

import todoom_agent as agent


class ClaudeEnvTest(unittest.TestCase):
    def test_secrets_are_not_passed_to_claude(self):
        env = {
            "PATH": "/usr/bin", "USERPROFILE": "C:/Users/me", "GOPATH": "C:/go", "GOPRIVATE": "gitlab.com/me",
            "ANTHROPIC_API_KEY": "sk-claude", "CLAUDE_CONFIG_DIR": "C:/claude",
            "GITLAB_TOKEN": "glpat-x", "GH_TOKEN": "ghp-x", "DB_PASSWORD": "p", "OPENAI_API_KEY": "k",
            "SSH_AUTH_SOCK": "/tmp/agent", "SSH_AGENT_PID": "42", "GIT_ASKPASS": "helper",
            "AWS_SECRET_ACCESS_KEY": "a", "AWS_PROFILE": "prod", "TAURI_SIGNING_PRIVATE_KEY": "key",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            kept = agent.claude_env()
        self.assertEqual(
            sorted(kept),
            sorted(["PATH", "USERPROFILE", "GOPATH", "GOPRIVATE", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR"]),
        )


class ClaudeCmdTest(unittest.TestCase):
    def test_runs_claude_directly_without_sandbox(self):
        with mock.patch.object(agent, "SANDBOX", []), mock.patch.object(agent, "claude_path", return_value="claude.exe"):
            self.assertEqual(agent.claude_cmd("-p", "x"), ["claude.exe", "-p", "x"])

    def test_runs_claude_inside_the_sandbox_command(self):
        sandbox = ["docker", "run", "--rm", "-v", "{repo}:/work", "img"]
        with mock.patch.object(agent, "SANDBOX", sandbox), mock.patch.object(agent, "REPO", Path("C:/clone")):
            cmd = agent.claude_cmd("-p", "x")
        self.assertEqual(cmd, ["docker", "run", "--rm", "-v", f"{Path('C:/clone')}:/work", "img", "claude", "-p", "x"])


class BranchNameTest(unittest.TestCase):
    def card(self, title, description=""):
        return {"id": "mw0abcdef123", "title": title, "description": description}

    def test_guess_picks_the_type_from_keywords_and_drops_accents(self):
        self.assertEqual(agent.guess_branch(self.card("Corriger le crash au démarrage")), "bugfix/corriger-crash-demarrage")
        self.assertEqual(agent.guess_branch(self.card("Faille de sécurité dans l'export")), "security/faille-securite-export")
        self.assertEqual(agent.guess_branch(self.card("Ajouter un export CSV")), "feature/ajouter-export-csv")
        self.assertEqual(agent.guess_branch(self.card("!!!")), "feature/ticket")

    def test_a_bad_suggestion_from_claude_falls_back_to_the_guess(self):
        for answer in ("bugfix/crash-demarrage", "Voici le nom : feature/x", "feature/Avec Espaces", ""):
            proc = mock.Mock(stdout=answer + "\n")
            with mock.patch.object(agent.subprocess, "run", return_value=proc):
                name = agent.suggest_branch(self.card("Corriger le crash au démarrage"))
            expected = answer if answer == "bugfix/crash-demarrage" else "bugfix/corriger-crash-demarrage"
            self.assertEqual(name, expected, answer)

    def test_claude_unavailable_falls_back_to_the_guess(self):
        with mock.patch.object(agent.subprocess, "run", side_effect=OSError("claude introuvable")):
            self.assertEqual(agent.suggest_branch(self.card("Ajouter un export CSV")), "feature/ajouter-export-csv")


class ResumeTest(unittest.TestCase):
    """A failed ticket sent back to « En cours » resumes on the branch named in its report."""

    def test_reuses_the_branch_of_the_last_attempt_when_it_still_exists(self):
        card = {"id": "mw0abcdef123", "title": "Ajouter un export CSV",
                "description": "Le ticket\n\n--- Agent (ÉCHEC) ---\nBranche : feature/old"}
        comments = [{"text": "--- Agent (ÉCHEC) ---\nBranche : feature/export-csv", "createdAt": "2026-11-20T10:00:00Z"}]
        local = {"feature/export-csv"}
        with mock.patch.object(agent, "comments_of", return_value=comments), \
             mock.patch.object(agent, "git", side_effect=lambda *a, **k: a[-1] if a[:2] == ("branch", "--list") and a[-1] in local else ""):
            self.assertEqual(agent.branch_for(card), "feature/export-csv")

    def test_older_reports_in_the_description_still_count(self):
        card = {"id": "mw0abcdef123", "title": "Ajouter un export CSV",
                "description": "Le ticket\n\n--- Agent (ÉCHEC) ---\nBranche : feature/old"}
        with mock.patch.object(agent, "comments_of", return_value=[]), \
             mock.patch.object(agent, "git", side_effect=lambda *a, **k: a[-1] if a[:2] == ("branch", "--list") else ""):
            self.assertEqual(agent.branch_for(card), "feature/old")

    def test_picks_a_new_name_with_a_suffix_when_it_is_taken(self):
        card = {"id": "mw0abcdef123", "title": "Ajouter un export CSV", "description": ""}
        with mock.patch.object(agent, "comments_of", return_value=[]), \
             mock.patch.object(agent, "suggest_branch", return_value="feature/export-csv"), \
             mock.patch.object(agent, "branch_exists", return_value=True):
            self.assertEqual(agent.branch_for(card), "feature/export-csv-def123")


class SyncedFolderTest(unittest.TestCase):
    """Anyone who can write the synced folder can write a card or a comment: they don't lead the agent elsewhere."""

    def test_a_card_whose_id_is_not_its_file_name_is_left_alone(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            board = Path(tmp) / "board"
            (board / "cards").mkdir(parents=True)
            agent.write_json(board / "board.json", {"columns": [{"id": "c1", "name": "En cours"}]})
            agent.write_json(board / "cards" / "x.json", {"id": "../../outside", "title": "T", "columnId": "c1"})
            agent.write_json(board / "cards" / "y.json", {"id": "other", "title": "T", "columnId": "c1"})
            with mock.patch.object(agent, "BOARD_DIR", board), \
                 mock.patch.object(agent, "ensure_columns", return_value={"En cours": "c1"}), \
                 mock.patch.object(agent, "process") as process:
                agent.tick()
            process.assert_not_called()
            self.assertFalse((Path(tmp) / "outside").exists())

    def test_a_comment_cannot_send_the_agent_to_another_branch(self):
        card = {"id": "mw0abcdef123", "title": "Ajouter un export CSV", "description": ""}
        for named in ["develop", "main", "release/1.0", "-f", "../x"]:
            comments = [{"text": f"Branche : {named}", "createdAt": "1"}]
            with mock.patch.object(agent, "comments_of", return_value=comments), \
                 mock.patch.object(agent, "suggest_branch", return_value="feature/export-csv"), \
                 mock.patch.object(agent, "branch_exists", return_value=False), \
                 mock.patch.object(agent, "git", side_effect=lambda *a, **k: "x"):
                self.assertEqual(agent.branch_for(card), "feature/export-csv", named)
        self.assertTrue(agent.own_branch_name("feature/export-csv-def123", card))

    def test_a_git_setup_changed_from_the_sandbox_is_seen_without_running_git(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            git_dir = Path(tmp) / ".git"
            (git_dir / "hooks").mkdir(parents=True)
            (git_dir / "config").write_text("[core]\n")
            (git_dir / "hooks" / "pre-commit.sample").write_text("x")
            with mock.patch.object(agent, "git", return_value=str(git_dir)):
                before = agent.git_setup()
            self.assertFalse(agent.git_setup_changed(before))
            (git_dir / "hooks" / "pre-push").write_text("#!/bin/sh\ntouch planted\n")
            self.assertTrue(agent.git_setup_changed(before))
            (git_dir / "hooks" / "pre-push").unlink()
            (git_dir / "config").write_text("[core]\n\tfsmonitor = touch planted\n")
            with mock.patch.object(agent, "git", side_effect=AssertionError("git must not run")):
                self.assertTrue(agent.git_setup_changed(before))


class ForgeTest(unittest.TestCase):
    def test_the_forge_is_read_from_the_remote_host_not_from_anywhere_in_its_address(self):
        for url, host in [("git@github.com:me/r.git", "github.com"), ("https://github.com/me/r", "github.com"),
                          ("https://gitlab.example.com/github.com/r", "gitlab.example.com"),
                          ("https://oauth2:x@gitlab.com/g/p.git", "gitlab.com")]:
            self.assertEqual(agent.remote_host(url), host, url)


class VerdictTest(unittest.TestCase):
    def test_success_needs_commits_and_a_clean_tree(self):
        self.assertEqual(agent.verdict(True, "fait", "abc1234 Ajoute l'export", ""), (True, "fait"))
        self.assertEqual(agent.verdict(True, "", "", ""), (False, "Aucun commit produit."))
        self.assertEqual(agent.verdict(True, "fini", "", ""), (False, "fini"))
        self.assertEqual(agent.verdict(True, "fait", "abc1234 x", " M main.go"), (False, "fait"))
        self.assertEqual(agent.verdict(False, "erreur", "abc1234 x", ""), (False, "erreur"))


class TrashTest(unittest.TestCase):
    def test_no_ticket_is_taken_from_a_board_in_the_trash(self):
        board = {"columns": [{"id": "c1", "name": "En cours"}], "archivedAt": "2026-11-20T10:00:00Z"}
        with mock.patch.object(agent, "BOARD_DIR", Path("board")), \
             mock.patch.object(agent, "read_json", return_value=board), \
             mock.patch.object(agent, "process") as process, \
             mock.patch.object(agent, "ensure_columns") as ensure_columns:
            agent.tick()
        process.assert_not_called()
        ensure_columns.assert_not_called()


class ConfigTest(unittest.TestCase):
    def load(self, cfg):
        with mock.patch.object(agent, "read_json", return_value=cfg):
            agent.load_config()

    def test_sandbox_defaults_to_none(self):
        self.load({"board_dir": "b", "repo": "r"})
        self.assertEqual(agent.SANDBOX, [])

    def test_sandbox_must_be_a_list_of_strings(self):
        with self.assertRaises(SystemExit):
            self.load({"board_dir": "b", "repo": "r", "sandbox": "docker run img"})

    def test_one_board_at_the_top_still_works_with_the_go_defaults(self):
        self.load({"board_dir": "b", "repo": "r"})
        self.assertEqual(len(agent.TARGETS), 1)
        self.assertEqual(agent.BOARD_DIR, Path("b"))
        self.assertIn("Bash(go *)", agent.allowed_tools())
        self.assertEqual(agent.FORGE, "gitlab")

    def test_several_boards_with_their_own_tools_checks_and_forge(self):
        self.load({
            "checks": "go test ./...",
            "boards": [
                {"board_dir": "solaris", "repo": "r1"},
                {"board_dir": "luna", "repo": "r2", "tools": ["npm *", "npx *"], "checks": "npm test", "forge": "github"},
            ],
        })
        self.assertEqual([t["board_dir"] for t in agent.TARGETS], [Path("solaris"), Path("luna")])
        agent.use(agent.TARGETS[1])
        self.assertEqual((agent.CHECKS, agent.FORGE), ("npm test", "github"))
        self.assertIn("Bash(npm *)", agent.allowed_tools())
        self.assertNotIn("Bash(go *)", agent.allowed_tools())
        agent.use(agent.TARGETS[0])
        self.assertEqual(agent.CHECKS, "go test ./...")
        self.assertIn("Bash(go *)", agent.allowed_tools())

    def test_bad_board_settings_are_refused(self):
        for cfg in ({"boards": [{"repo": "r"}]},
                    {"board_dir": "b", "repo": "r", "tools": "npm *"},
                    {"board_dir": "b", "repo": "r", "tools": ["git push *"]},
                    {"board_dir": "b", "repo": "r", "forge": "bitbucket"},
                    {"boards": []}):
            with self.assertRaises(SystemExit, msg=cfg):
                self.load(cfg)


class GitHubTest(unittest.TestCase):
    def test_opens_a_pull_request_with_gh_and_reuses_an_existing_one(self):
        ok = mock.Mock(returncode=0, stdout="", stderr="")
        exists = mock.Mock(returncode=1, stdout="",
                           stderr="a pull request for branch \"fix/x\" already exists:\nhttps://github.com/o/r/pull/3\n")
        with mock.patch.object(agent, "FORGE", "github"), \
             mock.patch.object(agent.shutil, "which", return_value="gh"), \
             mock.patch.object(agent.subprocess, "run", side_effect=[ok, exists]) as run:
            self.assertEqual(agent.push_branch("fix/x", "Corriger x"), "https://github.com/o/r/pull/3")
        self.assertEqual(run.call_args_list[0].args[0][:2], ["git", "push"])
        self.assertEqual(run.call_args_list[1].args[0][:3], ["gh", "pr", "create"])

    def test_without_gh_the_branch_is_pushed_and_the_request_left_to_open(self):
        ok = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(agent, "FORGE", "github"), \
             mock.patch.object(agent.shutil, "which", return_value=None), \
             mock.patch.object(agent.subprocess, "run", return_value=ok) as run:
            self.assertIsNone(agent.push_branch("fix/x", "Corriger x"))
        self.assertEqual(run.call_count, 1)


class StatusTest(unittest.TestCase):
    def test_status_is_written_on_changes_and_as_a_heartbeat(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(agent, "BOARD_DIR", Path(tmp)):
            agent._status.clear()
            path = Path(tmp) / "agents" / f"{agent.WRITER}.json"
            agent.write_status("idle")
            first = agent.read_json(path)
            self.assertEqual((first["state"], first["card"]), ("idle", None))
            path.unlink()
            agent.write_status("idle")
            self.assertFalse(path.exists(), "no rewrite within a minute when nothing changed")
            agent.write_status("working", {"id": "c1", "title": "T"})
            self.assertEqual(agent.read_json(path)["card"], {"id": "c1", "title": "T"})
            with mock.patch.object(agent.time, "time", return_value=time.time() + 120):
                path.unlink()
                agent.write_status("working", {"id": "c1", "title": "T"})
            self.assertTrue(path.exists(), "heartbeat after a minute")


class ActivityTest(unittest.TestCase):
    """Reports go to comments and moves to the history, in the formats the app reads."""

    def test_report_is_a_comment_and_moves_are_recorded(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            board = Path(tmp)
            (board / "cards").mkdir()
            card_path = board / "cards" / "mw0card.json"
            card = {"id": "mw0card", "title": "T", "description": "Le ticket", "columnId": "c1"}
            agent.write_json(card_path, card)
            cols = {"En cours": "c1", "Agent": "c2"}
            with mock.patch.object(agent, "BOARD_DIR", board):
                agent.move(card_path, card, "Agent", cols)
                agent.add_comment(card, "Rapport")
                comments = agent.comments_of(card)
            self.assertEqual([c["text"] for c in comments], ["Rapport"])
            self.assertEqual(comments[0]["author"]["agent"], "todoom-agent")
            self.assertEqual(agent.read_json(card_path)["description"], "Le ticket")
            history = agent.read_json(board / "history" / "mw0card" / f"{agent.WRITER}.json")
            self.assertEqual([(e["field"], e["from"], e["to"]) for e in history["events"]], [("column", "En cours", "Agent")])


class DevFieldsTest(unittest.TestCase):
    """The agent fills the branch and merge request, and marks it merged once in the base branch."""

    def test_branch_and_merge_request_are_filled_then_marked_merged(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            board = Path(tmp)
            (board / "cards").mkdir()
            card_path = board / "cards" / "mw0card.json"
            card = {"id": "mw0card", "title": "T", "description": "", "columnId": "c1"}
            url = "https://gitlab.example.com/g/p/-/merge_requests/7"
            events = agent.set_dev(card, "feature/export", url)
            self.assertEqual(card["branch"], "feature/export")
            self.assertEqual(card["mergeRequest"], {"url": url, "state": "open"})
            self.assertEqual([e["field"] for e in events], ["branch", "mergeRequest"])
            self.assertEqual(agent.set_dev(card, "feature/export", url), [])
            agent.write_json(card_path, card)
            merged = lambda *a, **k: "  feature/export" if a[:2] == ("branch", "--merged") else ""
            with mock.patch.object(agent, "BOARD_DIR", board), mock.patch.object(agent, "git", side_effect=merged):
                agent.mark_merged()
            self.assertEqual(agent.read_json(card_path)["mergeRequest"]["state"], "merged")
            history = agent.read_json(board / "history" / "mw0card" / f"{agent.WRITER}.json")
            self.assertEqual(history["events"][-1]["to"], f"merged {url}")


class ClaimTest(unittest.TestCase):
    """A card taken by someone else is left alone; the agent takes and releases the ones it works on."""

    def test_cards_held_by_someone_else_are_skipped(self):
        cols = {"En cours": "c1", "Agent": "c2", "A verifier": "c3", "Echec": "c4"}
        board = {"columns": [{"id": v, "name": k} for k, v in cols.items()]}
        mine = {"id": "a", "columnId": "c1", "claimedBy": {**agent.AUTHOR, "at": "x"}}
        free = {"id": "b", "columnId": "c1"}
        theirs = {"id": "c", "title": "C", "columnId": "c1", "claimedBy": {"host": agent.HOST, "agent": "Claude", "at": "x"}}
        files = {"board.json": board, "a.json": mine, "b.json": free, "c.json": theirs}

        class FakePath:
            def __init__(self, name):
                self.name = name
                self.stem = name.removesuffix(".json")

            def __truediv__(self, other):
                return FakePath(other)

            def glob(self, _):
                return [FakePath(n) for n in ("a.json", "b.json", "c.json")]

        with mock.patch.object(agent, "BOARD_DIR", FakePath("board")), \
             mock.patch.object(agent, "read_json", side_effect=lambda p: files.get(p.name, board)), \
             mock.patch.object(agent, "ensure_columns", return_value=cols), \
             mock.patch.object(agent, "write_status"), \
             mock.patch.object(agent, "process") as process:
            agent.tick()
        self.assertEqual(sorted(call.args[1]["id"] for call in process.call_args_list), ["a", "b"])

    def test_take_and_release_are_recorded(self):
        card = {"id": "x"}
        taken = agent.set_claim(card, True)
        self.assertEqual(card["claimedBy"]["agent"], "todoom-agent")
        self.assertEqual(taken[0]["field"], "claimedBy")
        self.assertEqual(agent.set_claim(card, True), [])
        released = agent.set_claim(card, False)
        self.assertIsNone(card["claimedBy"])
        self.assertIsNone(released[0]["to"])


class ContextTest(unittest.TestCase):
    def test_the_board_context_goes_before_the_ticket(self):
        with mock.patch.object(agent, "read_json", return_value={"description": "Dépôt : solaris\nRègle : pas de push"}), \
             mock.patch.object(agent, "BOARD_DIR", Path("board")):
            self.assertEqual(agent.board_context(), "Contexte du tableau (à respecter) :\nDépôt : solaris\nRègle : pas de push\n\n")
        with mock.patch.object(agent, "read_json", return_value={}), mock.patch.object(agent, "BOARD_DIR", Path("board")):
            self.assertEqual(agent.board_context(), "")
        self.assertIn("{context}Ticket", agent.PROMPT)


if __name__ == "__main__":
    unittest.main()
