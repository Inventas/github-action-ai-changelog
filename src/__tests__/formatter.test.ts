import { describe, it, expect } from 'vitest';
import { formatFallbackChangelog } from '../formatter.js';
import type { CommitInfo } from '../types.js';

function makeCommit(subject: string, files: string[] = []): CommitInfo {
  return { hash: 'abc123', subject, body: '', files };
}

describe('formatFallbackChangelog', () => {
  it('groups commits by conventional type in markdown', () => {
    const commits = [
      makeCommit('feat: add dark mode'),
      makeCommit('fix: crash on startup'),
      makeCommit('perf: faster image loading'),
    ];
    const result = formatFallbackChangelog(commits, 'markdown');
    expect(result).toContain('## New Features');
    expect(result).toContain('## Improvements');
    expect(result).toContain('## Bug Fixes');
    expect(result).toContain('add dark mode');
    expect(result).toContain('crash on startup');
    expect(result).toContain('faster image loading');
  });

  it('puts unrecognized commits under What\'s New in markdown', () => {
    const commits = [makeCommit('updated the splash screen')];
    const result = formatFallbackChangelog(commits, 'markdown');
    expect(result).toContain("## What's New");
    expect(result).toContain('updated the splash screen');
  });

  it('uses plain text headers when format is text', () => {
    const commits = [makeCommit('feat: offline mode')];
    const result = formatFallbackChangelog(commits, 'text');
    expect(result).toContain('New Features:');
    expect(result).not.toContain('## New Features');
  });

  it('handles scoped conventional commits', () => {
    const commits = [makeCommit('feat(auth): add biometric login')];
    const result = formatFallbackChangelog(commits, 'markdown');
    expect(result).toContain('## New Features');
    expect(result).toContain('add biometric login');
  });

  it('limits to 15 commits', () => {
    const commits = Array.from({ length: 20 }, (_, i) =>
      makeCommit(`feat: feature ${i}`)
    );
    const result = formatFallbackChangelog(commits, 'markdown');
    const bulletCount = (result.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(15);
  });

  it('returns default message when no commits', () => {
    const result = formatFallbackChangelog([], 'markdown');
    expect(result).toContain("What's New");
    expect(result).toContain('Minor improvements');
  });

  it('strips conventional prefix from ungrouped commits', () => {
    const commits = [makeCommit('chore(deps): bump some-lib from 1.0.0 to 1.1.0')];
    const result = formatFallbackChangelog(commits, 'markdown');
    // chore maps to Bug Fixes
    expect(result).toContain('## Bug Fixes');
    expect(result).toContain('bump some-lib');
    expect(result).not.toContain('chore(deps):');
  });
});
