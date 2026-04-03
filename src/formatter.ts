import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import type { CommitInfo } from './types.js';

const CONVENTIONAL_PREFIX = /^[a-zA-Z]+(\([^)]+\))?!?:\s*/;

const TYPE_TO_CATEGORY: Record<string, string> = {
  feat: 'New Features',
  fix: 'Bug Fixes',
  perf: 'Improvements',
  refactor: 'Improvements',
  improvement: 'Improvements',
  chore: 'Bug Fixes',
  docs: 'Improvements',
};

function extractConventionalType(subject: string): { type: string | null; message: string } {
  const match = subject.match(/^([a-zA-Z]+)(\([^)]+\))?!?:\s*(.*)/);
  if (!match) return { type: null, message: subject };
  return { type: match[1].toLowerCase(), message: match[3] };
}

/**
 * Basic fallback changelog when AI is unavailable.
 * Groups commits by conventional commit type if present, otherwise flat list.
 */
export function formatFallbackChangelog(
  commits: CommitInfo[],
  format: 'text' | 'markdown'
): string {
  const grouped: Record<string, string[]> = {};
  const ungrouped: string[] = [];

  for (const commit of commits.slice(0, 15)) {
    const { type, message } = extractConventionalType(commit.subject);
    if (!message) continue;

    const category = type ? TYPE_TO_CATEGORY[type] : null;
    if (category) {
      grouped[category] = grouped[category] ?? [];
      grouped[category].push(message);
    } else {
      ungrouped.push(commit.subject.replace(CONVENTIONAL_PREFIX, ''));
    }
  }

  const sections: string[] = [];

  const categoryOrder = ['New Features', 'Improvements', 'Bug Fixes'];
  for (const category of categoryOrder) {
    const items = grouped[category];
    if (!items || items.length === 0) continue;
    const header = format === 'markdown' ? `## ${category}` : `${category}:`;
    const bullets = items.map(i => `- ${i}`).join('\n');
    sections.push(`${header}\n${bullets}`);
  }

  if (ungrouped.length > 0) {
    const header = format === 'markdown' ? `## What's New` : `What's New:`;
    const bullets = ungrouped.map(i => `- ${i}`).join('\n');
    sections.push(`${header}\n${bullets}`);
  }

  if (sections.length === 0) {
    return format === 'markdown'
      ? '## What\'s New\n- Minor improvements and bug fixes'
      : 'What\'s New:\n- Minor improvements and bug fixes';
  }

  return sections.join('\n\n');
}

export function writeOutputFile(content: string, filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  core.info(`Changelog written to ${filePath}`);
}
