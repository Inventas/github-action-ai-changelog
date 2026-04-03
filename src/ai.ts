import * as core from '@actions/core';
import type { CommitInfo, DiffResult, GithubModelsMessage, GithubModelsResponse } from './types.js';

const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const API_VERSION = '2026-03-10';

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function callGithubModels(
  token: string,
  model: string,
  messages: GithubModelsMessage[],
  temperature = 0.3
): Promise<string> {
  const response = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub Models API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as GithubModelsResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('GitHub Models API returned empty content');
  return content;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  format: 'text' | 'markdown',
  customInstructions: string | null
): string {
  const formatInstructions =
    format === 'markdown'
      ? 'Use Markdown formatting: `##` for category headers and `- ` for bullets.'
      : 'Use plain text: category headers followed by a colon, and `- ` for bullets. No Markdown.';

  const base = `You are an expert at writing release notes for mobile and web applications.
Given git commit messages and code diffs, generate a clear, user-facing changelog.

Guidelines:
- Focus on what changed from the user's perspective, not internal implementation details.
- Group changes into categories: New Features, Improvements, Bug Fixes. Omit empty categories.
- Omit merge commits, CI/CD changes, dependency updates, and pure refactoring unless they affect user behavior.
- Keep each bullet to one concise sentence, written in plain language a non-developer can understand.
- Limit to 10-15 bullets total across all categories.
- ${formatInstructions}`;

  if (customInstructions?.trim()) {
    return `${base}\n\nAdditional instructions:\n${customInstructions.trim()}`;
  }
  return base;
}

function formatCommitsForPrompt(commits: CommitInfo[]): string {
  return commits
    .map(c => {
      const body = c.body ? `\n  ${c.body.replace(/\n/g, '\n  ')}` : '';
      return `- ${c.subject}${body}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Two-pass diff summarization
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_REQUESTS = 3;

async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    if (index >= tasks.length) return;
    const current = index++;
    results[current] = await tasks[current]();
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runNext));
  return results;
}

async function summarizeFileDiffs(
  token: string,
  model: string,
  fileSections: string[]
): Promise<string[]> {
  const tasks = fileSections.map(section => async () => {
    try {
      return await callGithubModels(
        token,
        model,
        [
          {
            role: 'user',
            content: `Summarize the following code changes in 2-3 sentences, focusing on what changed functionally (not how):\n\n${section}`,
          },
        ],
        0.2
      );
    } catch (err) {
      core.warning(`Failed to summarize a file diff chunk: ${err}`);
      // Extract just the file path from the diff header as a fallback
      const match = section.match(/^diff --git a\/(.*?) b\//m);
      return match ? `Changes to ${match[1]}` : 'Code changes';
    }
  });

  return withConcurrencyLimit(tasks, MAX_CONCURRENT_REQUESTS);
}

// ---------------------------------------------------------------------------
// Main changelog generation
// ---------------------------------------------------------------------------

/**
 * Generate a changelog using the GitHub Models API.
 * Uses a two-pass strategy for large diffs:
 *   1. Summarize each file's diff individually
 *   2. Use summaries + commit messages for the final changelog
 * Falls back to single-pass for small diffs.
 */
export async function generateChangelog(
  token: string,
  model: string,
  commits: CommitInfo[],
  diff: DiffResult,
  systemPrompt: string
): Promise<string> {
  const commitText = formatCommitsForPrompt(commits);

  let diffContext: string;

  if (diff.truncated && diff.rawDiff.length > 0) {
    core.info('Diff is large — using two-pass summarization strategy');

    // Split by file sections
    const fileSections = diff.rawDiff
      .split(/(?=diff --git )/)
      .filter(s => s.trim().startsWith('diff --git'));

    if (fileSections.length > 1) {
      const summaries = await summarizeFileDiffs(token, model, fileSections);
      diffContext = `## Per-file Change Summaries\n${summaries.map((s, i) => {
        const match = fileSections[i].match(/^diff --git a\/(.*?) b\//m);
        const fileName = match ? match[1] : `File ${i + 1}`;
        return `**${fileName}**: ${s}`;
      }).join('\n')}`;
    } else {
      diffContext = `## Code Changes (truncated)\n\`\`\`diff\n${diff.rawDiff}\n\`\`\``;
    }
  } else if (diff.rawDiff.length > 0) {
    diffContext = `## Code Changes\n\`\`\`diff\n${diff.rawDiff}\n\`\`\``;
  } else {
    diffContext = '';
  }

  const userMessage = [
    `## Commit Messages\n${commitText}`,
    diffContext,
    'Generate the changelog now.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return callGithubModels(
    token,
    model,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]
  );
}
