"""Prepare and validate Scio releases using only the Python standard library."""
import argparse
from datetime import date
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = Path("backend/app/VERSION")
SEMVER = r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
RELEASE_HEADER = re.compile(
    r"^## \[v(?P<version>" + SEMVER + r")\] - (?P<date>\d{4}-\d{2}-\d{2})$", re.M
)


def version_tuple(version):
    if not re.fullmatch(SEMVER, version):
        raise ValueError("Use a stable version X.Y.Z without a v prefix or leading zeroes.")
    return tuple(map(int, version.split(".")))


def release_notes(changelog, version):
    header = next((h for h in RELEASE_HEADER.finditer(changelog) if h["version"] == version), None)
    if header is None:
        raise ValueError(f"Missing dated changelog section for v{version}.")
    date.fromisoformat(header["date"])
    remainder = changelog[header.end():]
    notes = re.split(r"^## ", remainder, maxsplit=1, flags=re.M)[0].strip()
    if not re.sub(r"^### .*?$", "", notes, flags=re.M).strip():
        raise ValueError("Release notes must contain more than headings.")
    return notes


def check(root, tag=None):
    version = (root / VERSION_FILE).read_text().strip()
    version_tuple(version)
    package = json.loads((root / "frontend/package.json").read_text())
    lock = json.loads((root / "frontend/package-lock.json").read_text())
    if any(v != version for v in (package["version"], lock["version"], lock["packages"][""]["version"])):
        raise ValueError("Backend, frontend and package-lock versions must match.")
    changelog = (root / "CHANGELOG.md").read_text()
    headers = list(RELEASE_HEADER.finditer(changelog))
    if not headers or headers[0]["version"] != version:
        raise ValueError("The newest changelog release must match the app version.")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"Tag must be v{version}, got {tag}.")
    return release_notes(changelog, version)


def prepare(root, version):
    version_tuple(version)
    check(root)
    current = (root / VERSION_FILE).read_text().strip()
    if version_tuple(version) <= version_tuple(current):
        raise ValueError(f"New version must be greater than {current}.")
    changelog_path = root / "CHANGELOG.md"
    changelog = changelog_path.read_text()
    marker = "## [Unreleased]"
    if changelog.count(marker) != 1:
        raise ValueError("Expected exactly one ## [Unreleased] section.")
    updated = changelog.replace(marker, f"{marker}\n\n## [v{version}] - {date.today().isoformat()}", 1)
    release_notes(updated, version)  # Validate before writing any files.
    for filename in ("frontend/package.json", "frontend/package-lock.json"):
        path = root / filename
        data = json.loads(path.read_text())
        data["version"] = version
        if "packages" in data:
            data["packages"][""]["version"] = version
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    (root / VERSION_FILE).write_text(version + "\n")
    changelog_path.write_text(updated)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare").add_argument("version")
    validate = commands.add_parser("check")
    validate.add_argument("--tag")
    commands.add_parser("notes").add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            prepare(ROOT, args.version)
        elif args.command == "check":
            check(ROOT, args.tag)
        else:
            args.output.write_text(check(ROOT) + "\n")
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"Release validation failed: {error}\n")


if __name__ == "__main__":
    main()
