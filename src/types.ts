export interface ActionInputs {
  githubToken: string;
  tagPrefix: string;
  tagPattern: string;
  modulePaths: string[];
  outputFormat: 'text' | 'markdown';
  outputFile: string | null;
  model: string;
  customInstructions: string | null;
  maxDiffSize: number;
}

export interface ParsedTag {
  raw: string;
  prefix: string;
  version: string;
  build: string;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  body: string;
  files: string[];
}

export interface ResolvedRefs {
  baseRef: string;
  headRef: string;
  isFallback: boolean;
}

export interface DiffResult {
  rawDiff: string;
  truncated: boolean;
}

export interface GithubModelsMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GithubModelsResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
  }>;
}
