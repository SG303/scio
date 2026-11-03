"""Regression tests for release preparation and publication guards."""
import json
from pathlib import Path
import tempfile
import unittest

from release import VERSION_FILE, check, prepare


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / VERSION_FILE).parent.mkdir(parents=True)
        (self.root / VERSION_FILE).write_text("0.6.0\n")
        (self.root / "frontend").mkdir()
        (self.root / "frontend/package.json").write_text(json.dumps({"version": "0.6.0"}))
        (self.root / "frontend/package-lock.json").write_text(json.dumps({
            "version": "0.6.0", "packages": {"": {"version": "0.6.0"}},
        }))
        (self.root / "CHANGELOG.md").write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- New fix.\n\n"
            "## [v0.6.0] - 2026-11-03\n\n- Previous release.\n"
        )

    def test_prepare_updates_all_versions_and_moves_only_unreleased_notes(self):
        prepare(self.root, "0.6.1")
        self.assertEqual(check(self.root, "v0.6.1"), "### Fixed\n\n- New fix.")
        self.assertIn("## [Unreleased]\n\n## [v0.6.1]", (self.root / "CHANGELOG.md").read_text())
        self.assertIn("Previous release.", (self.root / "CHANGELOG.md").read_text())

    def test_wrong_tag_and_drift_block_publication(self):
        with self.assertRaises(ValueError):
            check(self.root, "v0.6.1")
        (self.root / "frontend/package.json").write_text('{"version": "0.1.1"}')
        with self.assertRaises(ValueError):
            check(self.root)

    def test_invalid_or_non_increasing_versions_leave_files_unchanged(self):
        original = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        for version in ("v0.7.0", "00.7.0", "0.7.0-rc.1", "0.5.0", "0.6.0"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                prepare(self.root, version)
        self.assertEqual(original, {p: p.read_bytes() for p in original})

    def test_empty_unreleased_section_cannot_be_released(self):
        path = self.root / "CHANGELOG.md"
        path.write_text(path.read_text().replace("- New fix.", ""))
        with self.assertRaises(ValueError):
            prepare(self.root, "0.7.0")
        self.assertEqual((self.root / VERSION_FILE).read_text(), "0.6.0\n")

    def test_missing_release_notes_block_publication(self):
        path = self.root / "CHANGELOG.md"
        path.write_text(path.read_text().replace("[v0.6.0]", "[v0.5.0]"))
        with self.assertRaises(ValueError):
            check(self.root)


if __name__ == "__main__":
    unittest.main()
