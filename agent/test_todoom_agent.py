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
