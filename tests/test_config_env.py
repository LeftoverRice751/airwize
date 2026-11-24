"""Tests for the tiny stdlib .env loader in config.py."""

import os
import shutil
import unittest
import uuid
from pathlib import Path

from config import load_env_file


class EnvFileTests(unittest.TestCase):
    def tearDown(self):
        for key in ("AIRWIZE_TEST_ONE", "AIRWIZE_TEST_TWO"):
            os.environ.pop(key, None)

    def write_env(self, text: str) -> Path:
        # The DSH sandbox restricts platform temp dirs and chmod, so use a
        # plain workspace folder and clean it up best-effort.
        directory = Path.cwd() / f"tmp-env-{uuid.uuid4().hex[:8]}"
        directory.mkdir()
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        path = directory / "env.txt"
        path.write_text(text, encoding="utf-8")
        return path

    def test_loads_plain_quoted_and_exported_values(self):
        path = self.write_env(
            "# comment\n"
            "AIRWIZE_TEST_ONE=plain value\n"
            'export AIRWIZE_TEST_TWO="quoted value"\n'
        )
        load_env_file(path)
        self.assertEqual(os.environ["AIRWIZE_TEST_ONE"], "plain value")
        self.assertEqual(os.environ["AIRWIZE_TEST_TWO"], "quoted value")

    def test_existing_environment_wins(self):
        path = self.write_env("AIRWIZE_TEST_ONE=from-file\n")
        os.environ["AIRWIZE_TEST_ONE"] = "from-shell"
        load_env_file(path)
        self.assertEqual(os.environ["AIRWIZE_TEST_ONE"], "from-shell")

    def test_missing_file_is_harmless(self):
        load_env_file(Path("does-not-exist.env"))


if __name__ == "__main__":
    unittest.main()
