"""Tests for what the agent hands to Claude. Run: python -m unittest discover -s agent"""

import os
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
                "description": "Le ticket\n\n--- Agent (ÉCHEC) ---\nBranche : feature/old\n\n--- Agent (ÉCHEC) ---\nBranche : feature/export-csv"}
        local = {"feature/export-csv"}
        with mock.patch.object(agent, "git", side_effect=lambda *a, **k: a[-1] if a[:2] == ("branch", "--list") and a[-1] in local else ""):
            self.assertEqual(agent.branch_for(card), "feature/export-csv")

    def test_picks_a_new_name_with_a_suffix_when_it_is_taken(self):
        card = {"id": "mw0abcdef123", "title": "Ajouter un export CSV", "description": ""}
        with mock.patch.object(agent, "suggest_branch", return_value="feature/export-csv"), \
             mock.patch.object(agent, "branch_exists", return_value=True):
            self.assertEqual(agent.branch_for(card), "feature/export-csv-def123")


class VerdictTest(unittest.TestCase):
    def test_success_needs_commits_and_a_clean_tree(self):
        self.assertEqual(agent.verdict(True, "fait", "abc1234 Ajoute l'export", ""), (True, "fait"))
        self.assertEqual(agent.verdict(True, "", "", ""), (False, "Aucun commit produit."))
        self.assertEqual(agent.verdict(True, "fini", "", ""), (False, "fini"))
        self.assertEqual(agent.verdict(True, "fait", "abc1234 x", " M main.go"), (False, "fait"))
        self.assertEqual(agent.verdict(False, "erreur", "abc1234 x", ""), (False, "erreur"))


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


if __name__ == "__main__":
    unittest.main()
