# AI Changelog Generator

A GitHub Action that generates concise, user-facing release notes from your git history using the GitHub Models API — no external API keys required.

It understands your tag structure, figures out what changed since the last release, reads both commit messages and actual code diffs, and produces changelog text ready for the App Store, Google Play, or any release pipeline.

## Features

- **AI-powered** — uses GitHub Models API (free with `GITHUB_TOKEN`, no external keys)
- **Smart tag resolution** — detects version bumps vs. build number bumps automatically
- **Monorepo support** — filter commits by one or more paths
- **Configurable tag patterns** — works with any tagging scheme
- **Graceful fallback** — if AI fails, produces a structured commit-based changelog
- **Two output formats** — markdown and plain text

## Quick Start

```yaml
- uses: inventas/github-action-ai-changelog@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    tag_prefix: my-app
```

> **Note:** The workflow needs `models: read` permission for GitHub Models API access.

```yaml
permissions:
  contents: read
  models: read
```

## Usage Example

```yaml
name: Release

on:
  push:
    tags:
      - 'my-app/**'

permissions:
  contents: read
  models: read

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # required: needs full git history

      - name: Generate changelog
        id: changelog
        uses: inventas/github-action-ai-changelog@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          tag_prefix: my-app
          output_format: markdown
          output_file: CHANGELOG.md

      - name: Use changelog output
        run: echo "${{ steps.changelog.outputs.changelog }}"
```

## Tag Pattern

The action resolves what to diff by inspecting the tag on the current commit. Given a tag like `festival-ios/2.4.0/71`:

| Scenario | Base ref | Head ref |
|---|---|---|
| Build bump (same version, new build) | Earliest build of `2.4.0` | Current tag |
| Version bump (new semver) | Last tag of `2.3.x` | Current tag |
| No tag on HEAD | Most recent matching tag | `HEAD` |
| No tags at all | — | Last 30 commits |

The pattern is configurable — see `tag_pattern` input below.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github_token` | **Yes** | — | Token with `models: read` permission |
| `tag_prefix` | **Yes** | — | Prefix to filter tags (e.g., `festival-ios`) |
| `tag_pattern` | No | `{prefix}/{version}/{build}` | Tag structure. Use `{prefix}`, `{version}`, `{build}` as placeholders, or supply a raw regex with named capture groups |
| `module_paths` | No | — | Comma-separated paths to filter commits (e.g., `modules/events,shared/core`) |
| `output_format` | No | `markdown` | `markdown` or `text` |
| `output_file` | No | — | Write changelog to this file (e.g., `fastlane/metadata/en-US/release_notes.txt`) |
| `model` | No | `openai/gpt-4.1-mini` | GitHub Models model ID in `{publisher}/{model}` format |
| `custom_instructions` | No | — | Extra instructions for the AI (e.g., `Write in German`, `Keep under 4000 characters`) |
| `max_diff_size` | No | `50000` | Max characters of diff to send to the AI. Larger diffs are summarized per-file first |

## Outputs

| Output | Description |
|---|---|
| `changelog` | The generated changelog text |
| `changes_detected` | `true` or `false` |
| `commit_count` | Number of commits analyzed |

## Examples

### App Store / Fastlane

```yaml
- name: Generate release notes
  id: changelog
  uses: inventas/github-action-ai-changelog@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    tag_prefix: festival-ios
    output_format: text
    output_file: fastlane/metadata/en-US/release_notes.txt
    custom_instructions: "Keep it under 4000 characters. Focus on user-facing features. Write in English."
```

### Monorepo with Multiple Paths

```yaml
- uses: inventas/github-action-ai-changelog@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    tag_prefix: festival-ios
    module_paths: modules/festival-events,modules/festival-map,shared/ui
    output_format: markdown
```

### Custom Tag Pattern

```yaml
# For tags like: v1.2.3-ios or v2.0.0-android
- uses: inventas/github-action-ai-changelog@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    tag_prefix: v
    tag_pattern: "{prefix}{version}-{build}"
```

### Custom Model

```yaml
- uses: inventas/github-action-ai-changelog@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    tag_prefix: my-app
    model: openai/gpt-4.1
    custom_instructions: "Write in German."
```

### Use Changelog in a Later Step

```yaml
- name: Generate changelog
  id: changelog
  uses: inventas/github-action-ai-changelog@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    tag_prefix: my-app

- name: Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    body: ${{ steps.changelog.outputs.changelog }}
```

## How It Works

1. **Tag resolution** — inspects the tag on HEAD (or finds the most recent matching tag) to determine the diff range
2. **Commit collection** — runs `git log` to gather commits, filtered by your module paths
3. **Diff extraction** — fetches the actual code diff between the two refs
4. **AI generation** — sends commit messages + diff to GitHub Models API with a release-note-focused prompt
   - For large diffs: summarizes each changed file individually, then synthesizes into a final changelog
   - For small diffs: single-pass with raw diff + commit messages
5. **Fallback** — if the API call fails for any reason, generates a structured changelog from commit messages alone

## Requirements

- The workflow must have `fetch-depth: 0` in `actions/checkout` (full git history is needed to resolve tags)
- The workflow permissions must include `models: read`

## Development

```bash
npm install
npm run build    # compile TypeScript + bundle with ncc
npm test         # run tests
npm run typecheck  # type check only
```

The `dist/` directory is committed to the repo — this is required for GitHub Actions to run the bundle directly without a separate install step.
