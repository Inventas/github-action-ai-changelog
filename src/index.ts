import * as core from '@actions/core';
import { resolveBaseRef, collectCommits, getDiff } from './git.js';
import { buildSystemPrompt, generateChangelog } from './ai.js';
import { formatFallbackChangelog, writeOutputFile } from './formatter.js';
import type { ActionInputs } from './types.js';

function parseInputs(): ActionInputs {
  const githubToken = core.getInput('github_token', { required: true });
  const tagPrefix = core.getInput('tag_prefix', { required: true });
  const tagPattern = core.getInput('tag_pattern') || '{prefix}/{version}/{build}';
  const modulePathsRaw = core.getInput('module_paths');
  const modulePaths = modulePathsRaw
    ? modulePathsRaw.split(',').map(p => p.trim()).filter(Boolean)
    : [];
  const outputFormatRaw = core.getInput('output_format') || 'markdown';
  const outputFormat = outputFormatRaw === 'text' ? 'text' : 'markdown';
  const outputFile = core.getInput('output_file') || null;
  const model = core.getInput('model') || 'openai/gpt-4.1-mini';
  const customInstructions = core.getInput('custom_instructions') || null;
  const maxDiffSizeRaw = core.getInput('max_diff_size');
  const maxDiffSize = maxDiffSizeRaw ? parseInt(maxDiffSizeRaw, 10) : 50000;

  return {
    githubToken,
    tagPrefix,
    tagPattern,
    modulePaths,
    outputFormat,
    outputFile,
    model,
    customInstructions,
    maxDiffSize,
  };
}

async function run(): Promise<void> {
  try {
    const inputs = parseInputs();

    core.info(`Tag prefix: ${inputs.tagPrefix}`);
    core.info(`Tag pattern: ${inputs.tagPattern}`);
    core.info(`Module paths: ${inputs.modulePaths.length > 0 ? inputs.modulePaths.join(', ') : '(all)'}`);
    core.info(`Model: ${inputs.model}`);

    // 1. Resolve base and head refs
    const { baseRef, headRef, isFallback } = resolveBaseRef(
      inputs.tagPrefix,
      inputs.tagPattern
    );

    if (isFallback) {
      core.warning('No matching tags found. Will use last 30 commits as fallback.');
    } else {
      core.info(`Diffing: ${baseRef || '<root>'}..${headRef}`);
    }

    // 2. Collect commits
    const commits = collectCommits(baseRef, headRef, inputs.modulePaths, 30);

    core.setOutput('commit_count', String(commits.length));

    if (commits.length === 0) {
      core.warning('No commits found in range.');
      core.setOutput('changes_detected', 'false');
      core.setOutput('changelog', 'No changes detected in this release.');
      return;
    }

    core.info(`Found ${commits.length} relevant commits`);
    core.setOutput('changes_detected', 'true');

    // 3. Extract diff
    const diff = getDiff(baseRef, headRef, inputs.modulePaths, inputs.maxDiffSize);
    if (diff.truncated) {
      core.info('Diff was truncated due to size — using two-pass summarization');
    }

    // 4. Generate AI changelog
    const systemPrompt = buildSystemPrompt(inputs.outputFormat, inputs.customInstructions);
    let changelog: string;

    try {
      changelog = await generateChangelog(
        inputs.githubToken,
        inputs.model,
        commits,
        diff,
        systemPrompt
      );
      core.info('AI changelog generated successfully');
    } catch (err) {
      core.warning(`AI generation failed: ${err}. Falling back to basic changelog.`);
      changelog = formatFallbackChangelog(commits, inputs.outputFormat);
    }

    // 5. Set outputs
    core.setOutput('changelog', changelog);

    // 6. Write to file if requested
    if (inputs.outputFile) {
      writeOutputFile(changelog, inputs.outputFile);
    }

    core.info('\n--- Generated Changelog ---\n' + changelog);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
