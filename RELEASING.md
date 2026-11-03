# Release Management

This guide is mandatory for maintainers and AI agents. Scio uses Semantic
Versioning, a maintained changelog, and explicitly triggered releases.
Merging to `main` alone does not publish anything. No additional services,
tokens, or release dependencies are required: GitHub Actions uses `GITHUB_TOKEN`.

All content published to GitHub must be in English, including commit messages,
PRs, issues, review comments, release notes, and repository documentation.
Changelog entries and section headings must also be in English. Translations of
historical changelog entries preserve their meaning, versions, and dates; they
do not change existing tags or published release artifacts.

## Versions and changes

- Tags: `vMAJOR.MINOR.PATCH`, stable releases only; no prereleases.
- `PATCH`: compatible bug fixes; `MINOR`: new features;
  `MAJOR`: incompatible changes starting at 1.0. Before 1.0, incompatible
  changes require a new minor version and an explicit upgrade note.
- The authoritative app version is `backend/app/VERSION`; FastAPI reads it
  directly (visible at `/docs`). `frontend/package.json` and both root version
  fields in `frontend/package-lock.json` must match. The release script updates
  these files together; do not maintain their versions separately by hand.
- This process starts from **0.6.0**, already documented in the changelog.
  Do not retroactively change historical release artifacts or tags.
- For each relevant change, add a clear English entry under `## [Unreleased]`
  in `CHANGELOG.md`: `Added`, `Changed`, `Fixed`, and `Upgrade notes` as needed.
  Empty sections are unnecessary. Explicitly mention migrations, new volumes
  or variables, and incompatible changes.
- Not every commit needs a release. Choose the version bump based on all
  changes since the previous release, rather than the number of commits.

## Prepare a release

1. Fetch current tags and `main` (`git fetch origin --tags`), then review the
   changelog and changes since the previous tag. Prepare the release on a
   dedicated branch; do not commit unrelated working files or user data.
2. Review `Unreleased` in full and choose the new version. From the repository root:

   ```bash
   python3 scripts/release.py prepare 0.6.1
   python3 scripts/release.py check
   ```

   Replace the example version. The script bumps all version fields, dates
   the existing `Unreleased` content, and leaves an empty `Unreleased` section
   for future changes. It creates neither a commit nor a tag.
3. All checks must pass:

   ```bash
   python3 -m unittest discover -s scripts -p 'test_*.py'
   (cd backend && .venv/bin/pytest)  # alternatively: pytest in an activated environment
   (cd frontend && npm run typecheck && npm run lint && npm test && npm run build)
   docker build -t scio:release-check .
   ```

4. Open the app with the prepared version and verify the affected workflows.
   Do not run paid AI generation without a corresponding request. Add a
   concrete, nontechnical click-test instruction to the changelog if needed
   for the release. Commit as `chore: release vX.Y.Z`, open a PR, and merge
   into `main` after CI passes.

Regular CI checks version consistency and release script tests in addition
to app tests. CI does not replace the manual click test.

## Publish a release

Proceed only when publication has been requested. Setting up this process
or making a regular feature change alone does not authorize a release.

1. Check out the merged release commit on `main`, ensure the working tree
   is clean, and validate metadata again. Example:

   ```bash
   git switch main
   git pull --ff-only origin main
   python3 scripts/release.py check --tag v0.6.1
   git tag -a v0.6.1 -m 'Scio v0.6.1'
   git push origin v0.6.1
   ```

   Replace the version. Each release needs a new tag. Never move, delete,
   or reuse an existing tag for another commit.
2. Monitor the **Build and Push Docker Image** workflow. It requires a matching
   stable tag on a commit from `main`, validates metadata, and runs backend
   tests, frontend typechecking, lint, and unit tests. Only then does it build
   and publish the image:

   - `ghcr.io/sg303/scio:vX.Y.Z`
   - `ghcr.io/sg303/scio:latest`

3. Only after the image has been pushed successfully does the workflow create
   a GitHub Release using exactly the dated changelog section as release notes.
   Verify it under GitHub → Releases → version; check the Actions run and GHCR
   tag. A release is considered published only after the entire workflow succeeds.

Manual workflow dispatch is intended only for retries on the **same tag**,
not on a branch. If a run fails, rerun the failed jobs; an existing GitHub Release
will receive updated notes. If code needs changing, prepare a new version
instead of moving the tag. Publications run serially. Publish new versions only
in ascending order: rerunning the entire workflow for an old tag would also
point `latest` at that version. If the release step fails, rerun only the failed
jobs, rather than the successful image build.

## Update and rollback on the owner's installation

The existing Compose template builds locally from the checkout. Publishing
a GitHub Release does not update that installation automatically. To install
a specific release:

1. Stop the container (`docker compose down`). Back up all of `data/` and
   `uploads/` to a separate location; if used, also back up the confidential
   `claude/` directory. Automatic database backups do not include uploaded images.
2. Check out the release tag (`git fetch origin --tags`,
   `git switch --detach vX.Y.Z`), then run `docker compose up -d --build`.
   Keep local Compose and environment files. Migrations run automatically
   on startup.
3. Open the app: visit the Dashboard, an existing subject, and a deck; verify
   existing notes and images. `/docs` shows the installed app version.

Alternatively, replace `build: .` in the local Compose file with
`image: ghcr.io/sg303/scio:vX.Y.Z`, then run
`docker compose pull && docker compose up -d --no-build`. Keep volumes and
settings. Record the image digest from GHCR for reproducible deployments;
`latest` is a moving pointer and is unsuitable as a rollback target.

If problems occur, stop the container, restore the previous code tag or image
digest together with matching backups of `data/` and `uploads/`, and restart.
An older image alone does not undo database migrations. Restoring a backup loses
changes made since that backup, so coordinate data restoration with the owner.
Do not improvise down migrations or delete or rename data tables as a repair.
