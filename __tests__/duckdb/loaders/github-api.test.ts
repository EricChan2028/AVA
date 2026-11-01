/**
 * Live GitHub check: load a public repository and compare table counts with
 * GitHub's own search counts. Run with AVA_GITHUB_TEST=1; set GITHUB_TOKEN or
 * GH_TOKEN for higher rate limits and AVA_GITHUB_TEST_REPOSITORY to pick the
 * repository (default antvis/AVA). Counts can differ briefly while GitHub's
 * search index catches up with new activity.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AVA } from '../../../src';

const repository = process.env.AVA_GITHUB_TEST_REPOSITORY || 'antvis/AVA';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;

async function searchCount(query: string): Promise<number> {
  const response = await fetch(`https://api.github.com/search/issues?per_page=1&q=${encodeURIComponent(query)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': '@antv/ava-test',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = (await response.json()) as { total_count?: number; message?: string };
  if (!response.ok || typeof body.total_count !== 'number') {
    throw new Error(`GitHub search failed (${response.status} ${body.message})`);
  }
  return body.total_count;
}

describe.skipIf(process.env.AVA_GITHUB_TEST !== '1')('loaders/github live API', () => {
  const ava = new AVA({ llm: { model: 'no-model-call' } });

  beforeAll(async () => {
    await ava.source({ type: 'github', options: { repository, token } });
  }, 120_000);

  afterAll(() => ava.dispose());

  it.each([
    ['issues', 'SELECT count(*) AS n FROM issues', 'is:issue'],
    ['open issues', "SELECT count(*) AS n FROM issues WHERE state = 'open'", 'is:issue is:open'],
    ['pull requests', 'SELECT count(*) AS n FROM pull_requests', 'is:pr'],
    ['closed pull requests', "SELECT count(*) AS n FROM pull_requests WHERE state = 'closed'", 'is:pr is:closed'],
    ['merged pull requests', 'SELECT count(*) AS n FROM pull_requests WHERE is_merged', 'is:pr is:merged'],
    [
      'pull requests closed without merging',
      "SELECT count(*) AS n FROM pull_requests WHERE state = 'closed' AND NOT is_merged",
      'is:pr is:closed is:unmerged',
    ],
  ])(
    'matches the GitHub search count of %s',
    async (_name, sql, qualifiers) => {
      const [{ n }] = (await ava.query(sql)).data as { n: number }[];
      expect(n).toBe(await searchCount(`repo:${repository} ${qualifiers}`));
    },
    30_000
  );

  it('matches the open item count GitHub reports for the repository', async () => {
    const [{ n }] = (
      await ava.query(`SELECT r.open_issues_and_pull_requests - (
        (SELECT count(*) FROM issues WHERE state = 'open') + (SELECT count(*) FROM pull_requests WHERE state = 'open')
      ) AS n FROM repositories r`)
    ).data as { n: number }[];
    expect(n).toBe(0);
  });
});
