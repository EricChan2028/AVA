/**
 * Case: natural-language analysis of a GitHub repository.
 * Loads the fictional acme/widgets repository from a stubbed GitHub API, then
 * asks questions against the real LLM API and checks the numbers in the results.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AVA } from '../../src';
import { getLLMConfig, skipLLMTests } from '../test-utils';
import { mockGitHubApi, widgetsRoutes } from '../duckdb/loaders/github-fixtures';

/** Finite numbers anywhere in the result rows. */
function numbers(data: Record<string, unknown>[]): number[] {
  return data
    .flatMap((row) => Object.values(row))
    .map(Number)
    .filter(Number.isFinite);
}

describe.skipIf(skipLLMTests)('cases/github-analysis', () => {
  let ava: AVA;

  beforeAll(async () => {
    mockGitHubApi(widgetsRoutes);
    ava = new AVA({ llm: getLLMConfig() });
    await ava.source({
      type: 'github',
      options: {
        repository: 'acme/widgets',
        resources: ['issues', 'pull_requests', 'labels', 'milestones', 'releases', 'comments'],
      },
    });
    // The tables are loaded; restore fetch for the model API.
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await ava?.dispose();
  });

  it.each([
    ['How many pull requests were merged?', [1]],
    ['How many pull requests were opened by bots?', [1]],
    ['How many open issues are labeled "good first issue"?', [1]],
    ['On average, how many hours passed between opening and merging a merged pull request?', [26]],
    [
      'For each issue, how many minutes after it was opened did someone other than its author first comment? Only include issues with such a comment.',
      [90, 2880],
    ],
    ['What is the total number of downloads across all release assets?', [155]],
  ])(
    'answers: %s',
    async (question, expected) => {
      const result = await ava.analyze(question);
      const values = numbers(result.data);
      for (const value of expected) {
        expect(
          values.some((actual) => Math.abs(actual - value) < 0.01),
          `${value} in ${JSON.stringify(result.data)} (${result.sql})`
        ).toBe(true);
      }
    },
    120_000
  );
});
