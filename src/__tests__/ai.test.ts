import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../ai.js';

describe('buildSystemPrompt', () => {
  it('includes markdown format instructions when format is markdown', () => {
    const prompt = buildSystemPrompt('markdown', null);
    expect(prompt).toContain('##');
    expect(prompt).toContain('Markdown');
  });

  it('includes plain text instructions when format is text', () => {
    const prompt = buildSystemPrompt('text', null);
    expect(prompt).toContain('plain text');
    expect(prompt).not.toContain('`##`');
  });

  it('appends custom instructions verbatim', () => {
    const prompt = buildSystemPrompt('markdown', 'Write in German. Focus on bugs.');
    expect(prompt).toContain('Write in German. Focus on bugs.');
    expect(prompt).toContain('Additional instructions:');
  });

  it('does not add custom instructions section when null', () => {
    const prompt = buildSystemPrompt('markdown', null);
    expect(prompt).not.toContain('Additional instructions:');
  });

  it('does not add custom instructions section for empty string', () => {
    const prompt = buildSystemPrompt('markdown', '');
    expect(prompt).not.toContain('Additional instructions:');
  });
});
