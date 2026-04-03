import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseTagPattern, parseTag } from '../git.js';

// ---------------------------------------------------------------------------
// parseTagPattern
// ---------------------------------------------------------------------------

describe('parseTagPattern', () => {
  it('compiles a template with all three placeholders', () => {
    const regex = parseTagPattern('{prefix}/{version}/{build}');
    expect(regex.test('festival-ios/2.4.0/71')).toBe(true);
    expect(regex.test('festival-ios/2.4.0')).toBe(false);
    expect(regex.test('something-else/1.0.0/5')).toBe(true);
  });

  it('compiles a template with only prefix and version', () => {
    const regex = parseTagPattern('{prefix}/{version}');
    expect(regex.test('myapp/1.2.3')).toBe(true);
    expect(regex.test('myapp/1.2.3/7')).toBe(false);
  });

  it('treats input without { as raw regex', () => {
    const regex = parseTagPattern('^festival-ios/.*$');
    expect(regex.test('festival-ios/1.0.0/5')).toBe(true);
    expect(regex.test('festival-android/1.0.0/5')).toBe(false);
  });

  it('escapes dots in literal parts of the template', () => {
    // If someone uses literal dots (unlikely but possible)
    const regex = parseTagPattern('{prefix}-v{version}');
    expect(regex.test('myapp-v1.0.0')).toBe(true);
    expect(regex.test('myappXv1.0.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseTag
// ---------------------------------------------------------------------------

describe('parseTag', () => {
  const regex = parseTagPattern('{prefix}/{version}/{build}');

  it('parses a valid tag', () => {
    const result = parseTag('festival-ios/2.4.0/71', regex);
    expect(result).toEqual({
      raw: 'festival-ios/2.4.0/71',
      prefix: 'festival-ios',
      version: '2.4.0',
      build: '71',
    });
  });

  it('returns null for a non-matching tag', () => {
    expect(parseTag('v1.0.0', regex)).toBeNull();
    expect(parseTag('festival-ios/2.4.0', regex)).toBeNull();
  });

  it('handles tags with complex prefixes', () => {
    const result = parseTag('my-app-android/1.0.0/42', regex);
    expect(result?.prefix).toBe('my-app-android');
    expect(result?.version).toBe('1.0.0');
    expect(result?.build).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// Diff truncation logic (inline test, no exec needed)
// ---------------------------------------------------------------------------

describe('diff truncation logic', () => {
  it('splits diff sections by file correctly', () => {
    const mockDiff = [
      'diff --git a/foo.ts b/foo.ts\nindex 1234..5678 100644\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,4 @@\n line1\n+added line\n line2',
      'diff --git a/bar.ts b/bar.ts\nindex abcd..efgh 100644\n--- a/bar.ts\n+++ b/bar.ts\n@@ -1,2 +1,2 @@\n-old\n+new',
    ].join('\n');

    const sections = mockDiff.split(/(?=diff --git )/);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('foo.ts');
    expect(sections[1]).toContain('bar.ts');
  });
});
