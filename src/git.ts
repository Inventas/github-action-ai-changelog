import { execSync } from 'child_process';
import * as core from '@actions/core';
import type { ParsedTag, CommitInfo, ResolvedRefs, DiffResult } from './types.js';

// ---------------------------------------------------------------------------
// Tag pattern parsing
// ---------------------------------------------------------------------------

/**
 * Compile a tag pattern into a named-capture-group regex.
 * If the pattern contains `{`, it's treated as a template where:
 *   {prefix}, {version}, {build} become named capture groups.
 * Otherwise, the pattern is used as-is as a regex string.
 */
export function parseTagPattern(pattern: string): RegExp {
  if (!pattern.includes('{')) {
    return new RegExp(pattern);
  }

  // Escape all regex special chars first, then restore our placeholders
  let regexStr = pattern
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&') // escape all
    .replace(/\\{prefix\\}/g, '(?<prefix>[^/]+)')
    .replace(/\\{version\\}/g, '(?<version>[^/]+)')
    .replace(/\\{build\\}/g, '(?<build>[^/]+)');

  return new RegExp(`^${regexStr}$`);
}

export function parseTag(tag: string, regex: RegExp): ParsedTag | null {
  const match = regex.exec(tag);
  if (!match?.groups) return null;
  const { prefix = '', version = '', build = '' } = match.groups;
  return { raw: tag, prefix, version, build };
}

// ---------------------------------------------------------------------------
// Semver comparison helpers
// ---------------------------------------------------------------------------

function parseSemver(v: string): [number, number, number] {
  const parts = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!parts) return [0, 0, 0];
  return [parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3])];
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

function sortParsedTags(tags: ParsedTag[]): ParsedTag[] {
  return [...tags].sort((a, b) => {
    const semverDiff = compareSemver(a.version, b.version);
    if (semverDiff !== 0) return semverDiff;
    return parseInt(a.build || '0') - parseInt(b.build || '0');
  });
}

// ---------------------------------------------------------------------------
// Git utilities
// ---------------------------------------------------------------------------

function exec(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Get tags pointing at HEAD, optionally filtered by prefix.
 */
export function getTagsOnHead(prefix: string): string[] {
  const out = exec('git tag --points-at HEAD');
  if (!out) return [];
  return out
    .split('\n')
    .map(t => t.trim())
    .filter(t => t && (!prefix || t.startsWith(prefix)));
}

/**
 * List all tags matching a prefix, sorted newest-first by version refname.
 */
export function listTags(prefix: string): string[] {
  const pattern = prefix ? `"${prefix}*"` : '"*"';
  const out = exec(`git tag -l ${pattern} --sort=-v:refname`);
  if (!out) return [];
  return out.split('\n').map(t => t.trim()).filter(Boolean);
}

/**
 * Get the root commit of the repo (used as base when there are no prior tags).
 */
function getRootCommit(): string {
  return exec('git rev-list --max-parents=0 HEAD');
}

// ---------------------------------------------------------------------------
// Tag resolution
// ---------------------------------------------------------------------------

/**
 * Core algorithm: determine baseRef and headRef to diff between.
 *
 * Rules:
 * 1. If HEAD has a matching tag:
 *    - Parse it to get version + build
 *    - If same version exists in older tags → BUILD BUMP
 *      → base = earliest tag with this version
 *    - If previous tags have a different version → VERSION BUMP
 *      → base = last tag of the previous version
 *    - If no prior tags at all → first release, base = root commit
 * 2. If HEAD has no matching tag:
 *    → diff most recent matching tag..HEAD
 * 3. If no tags at all:
 *    → isFallback = true (caller should use last N commits)
 */
export function resolveBaseRef(
  tagPrefix: string,
  tagPattern: string
): ResolvedRefs {
  const regex = parseTagPattern(tagPattern);

  const headTags = getTagsOnHead(tagPrefix);
  const headTag = headTags.length > 0 ? headTags[0] : null;

  const allTagRaw = listTags(tagPrefix);
  const allTags = allTagRaw
    .map(t => parseTag(t, regex))
    .filter((t): t is ParsedTag => t !== null);

  if (allTags.length === 0) {
    return { baseRef: '', headRef: 'HEAD', isFallback: true };
  }

  if (headTag) {
    const parsedHead = parseTag(headTag, regex);
    if (!parsedHead) {
      // Tag doesn't match pattern — treat like no tag
      return { baseRef: allTags[allTags.length - 1].raw, headRef: 'HEAD', isFallback: false };
    }

    const sortedTags = sortParsedTags(allTags);
    const headIdx = sortedTags.findIndex(t => t.raw === headTag);

    // Tags with the same version (excluding head itself)
    const sameVersionTags = sortedTags.filter(
      (t, i) => t.version === parsedHead.version && i !== headIdx
    );

    if (sameVersionTags.length > 0) {
      // Build bump: diff from the earliest build of this version
      const earliestSameVersion = sameVersionTags[0];
      core.info(`Build bump detected. Diffing from earliest build of ${parsedHead.version}: ${earliestSameVersion.raw}`);
      return { baseRef: earliestSameVersion.raw, headRef: headTag, isFallback: false };
    }

    // Version bump: find the most recent tag of the previous version
    const previousVersionTags = sortedTags.filter(
      (t, i) => compareSemver(t.version, parsedHead.version) < 0 && i !== headIdx
    );

    if (previousVersionTags.length > 0) {
      const lastPrevVersion = previousVersionTags[previousVersionTags.length - 1];
      core.info(`Version bump detected. Diffing from last tag of previous version: ${lastPrevVersion.raw}`);
      return { baseRef: lastPrevVersion.raw, headRef: headTag, isFallback: false };
    }

    // First release ever
    const rootCommit = getRootCommit();
    core.info(`First release. Diffing from root commit.`);
    return { baseRef: rootCommit || '', headRef: headTag, isFallback: !rootCommit };
  }

  // No tag on HEAD — diff from most recent matching tag to HEAD
  const latestTag = sortParsedTags(allTags)[allTags.length - 1];
  core.info(`No tag on HEAD. Diffing from most recent tag: ${latestTag.raw}`);
  return { baseRef: latestTag.raw, headRef: 'HEAD', isFallback: false };
}

// ---------------------------------------------------------------------------
// Commit collection
// ---------------------------------------------------------------------------

/**
 * Parse the output of git log --name-only with null-byte delimiters.
 * Each entry block looks like:
 *   {hash}\x00{subject}\x00{body}\x00
 *   file1
 *   file2
 *   (blank line)
 */
function parseGitLogOutput(raw: string): CommitInfo[] {
  if (!raw) return [];

  const commits: CommitInfo[] = [];
  // Split on the record separator we pass to git log
  const records = raw.split('\x1e').filter(Boolean);

  for (const record of records) {
    const nullParts = record.split('\x00');
    if (nullParts.length < 2) continue;

    const hash = nullParts[0]?.trim();
    const subject = nullParts[1]?.trim() || '';
    const bodyAndFiles = nullParts.slice(2).join('\x00');

    // Files come after the body, separated by a blank line
    const bodyFileSplit = bodyAndFiles.split(/\n\n|\r\n\r\n/);
    const body = bodyFileSplit[0]?.trim() || '';
    const filesSection = bodyFileSplit.slice(1).join('\n');
    const files = filesSection
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);

    if (!hash || !subject) continue;
    if (subject.startsWith('Merge ')) continue;

    commits.push({ hash, subject, body, files });
  }

  return commits;
}

/**
 * Should a commit be included given the module paths filter?
 *
 * Inclusion criteria (when modulePaths is non-empty):
 *   - The commit touches at least one file under any of the module paths, OR
 *   - The commit touches files both inside AND outside module paths
 *     (shared code heuristic — likely relevant to the module)
 */
function isCommitRelevant(commit: CommitInfo, modulePaths: string[]): boolean {
  if (modulePaths.length === 0) return true;
  if (commit.files.length === 0) return true; // can't filter, include

  const touchesModule = commit.files.some(f =>
    modulePaths.some(p => f.startsWith(p))
  );

  if (touchesModule) return true;

  // Shared code heuristic: touches files both inside and outside module paths
  const touchesOutside = commit.files.some(f =>
    !modulePaths.some(p => f.startsWith(p))
  );
  return touchesModule || (touchesOutside && touchesModule);
}

/**
 * Collect commits between baseRef and headRef, optionally filtered by module paths.
 */
export function collectCommits(
  baseRef: string,
  headRef: string,
  modulePaths: string[],
  fallbackCount: number
): CommitInfo[] {
  // Use record separator (\x1e) between commits and null bytes within fields
  const format = '%x1e%H%x00%s%x00%b';

  let cmd: string;
  if (baseRef) {
    const pathFilter = modulePaths.length > 0
      ? `-- ${modulePaths.map(p => `"${p}"`).join(' ')}`
      : '';
    cmd = `git log ${baseRef}..${headRef} --pretty=format:"${format}" --name-only ${pathFilter}`;
  } else {
    cmd = `git log --pretty=format:"${format}" --name-only -n ${fallbackCount}`;
  }

  const output = exec(cmd);
  const commits = parseGitLogOutput(output);

  // If we used a path filter in git log, commits are already pre-filtered.
  // If not (no module paths or no baseRef), apply our relevance filter.
  if (modulePaths.length === 0 || !baseRef) {
    return commits.filter(c => isCommitRelevant(c, modulePaths));
  }

  return commits;
}

// ---------------------------------------------------------------------------
// Diff extraction
// ---------------------------------------------------------------------------

/**
 * Get the unified diff between baseRef and headRef.
 * If the diff exceeds maxSize characters, truncate intelligently:
 * split by file, distribute the budget evenly, keep file headers + first N lines.
 */
export function getDiff(
  baseRef: string,
  headRef: string,
  modulePaths: string[],
  maxSize: number
): DiffResult {
  if (!baseRef) return { rawDiff: '', truncated: false };

  const pathFilter = modulePaths.length > 0
    ? `-- ${modulePaths.map(p => `"${p}"`).join(' ')}`
    : '';

  const rawDiff = exec(`git diff ${baseRef}..${headRef} ${pathFilter}`);

  if (rawDiff.length <= maxSize) {
    return { rawDiff, truncated: false };
  }

  // Truncate per-file: split on "diff --git" boundaries
  const fileSections = rawDiff.split(/(?=diff --git )/);
  if (fileSections.length <= 1) {
    return { rawDiff: rawDiff.slice(0, maxSize), truncated: true };
  }

  const budgetPerFile = Math.floor(maxSize / fileSections.length);
  const truncated = fileSections.map(section => {
    if (section.length <= budgetPerFile) return section;
    // Keep the file header lines (until first @@) plus as many diff lines as budget allows
    const headerEnd = section.indexOf('\n@@');
    const headerPart = headerEnd > 0 ? section.slice(0, headerEnd) : section.slice(0, 200);
    const remaining = budgetPerFile - headerPart.length;
    if (remaining <= 0) return headerPart + '\n... (truncated)\n';
    return headerPart + section.slice(headerEnd, headerEnd + remaining) + '\n... (truncated)\n';
  });

  return { rawDiff: truncated.join(''), truncated: true };
}
