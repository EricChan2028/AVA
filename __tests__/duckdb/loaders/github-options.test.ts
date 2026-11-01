/**
 * GitHub repository names, links and the `since` filter.
 */

import { describe, expect, it } from 'vitest';

import { githubSince } from '../../../src/duckdb/loaders/github/options';
import { isGitHubRepositoryUrl, parseGitHubRepository } from '../../../src/duckdb/loaders/github/repository';

describe('parseGitHubRepository', () => {
  it.each([
    ['antvis/AVA', { owner: 'antvis', name: 'AVA' }],
    [' antvis/AVA ', { owner: 'antvis', name: 'AVA' }],
    ['https://github.com/antvis/AVA', { owner: 'antvis', name: 'AVA' }],
    ['https://github.com/antvis/AVA/', { owner: 'antvis', name: 'AVA' }],
    ['https://www.github.com/antvis/AVA.git', { owner: 'antvis', name: 'AVA' }],
    ['https://github.com/antvis/AVA/issues?q=is%3Aopen#top', { owner: 'antvis', name: 'AVA' }],
    ['https://github.com/antvis/AVA/pulls', { owner: 'antvis', name: 'AVA' }],
    ['https://github.com/antvis/AVA/releases', { owner: 'antvis', name: 'AVA' }],
    ['https://github.com/vercel/next.js/milestones', { owner: 'vercel', name: 'next.js' }],
    ['https://github.com/my-org/my_repo.v2/labels', { owner: 'my-org', name: 'my_repo.v2' }],
  ])('parses %s', (input, expected) => {
    expect(parseGitHubRepository(input)).toEqual(expected);
  });

  it.each([
    'antvis',
    'antvis/AVA/extra',
    '-antvis/AVA',
    'antvis/..',
    'antvis/a b',
    'https://github.com/antvis',
    'https://github.com/antvis/AVA/blob/ai/README.md',
    'https://github.com/antvis/AVA/issues/1015',
  ])('rejects %s', (input) => {
    expect(() => parseGitHubRepository(input)).toThrow('Invalid GitHub repository');
  });

  it('asks GitHub Enterprise users for apiUrl and owner/name', () => {
    expect(() => parseGitHubRepository('https://github.example.com/acme/widgets')).toThrow(
      'GitHub repository links must be on github.com'
    );
  });

  it('recognizes repository links for the CLI', () => {
    expect(isGitHubRepositoryUrl('https://github.com/antvis/AVA')).toBe(true);
    expect(isGitHubRepositoryUrl('antvis/AVA')).toBe(false);
    expect(isGitHubRepositoryUrl('https://github.com/antvis/AVA/blob/ai/data/sales.csv')).toBe(false);
    expect(isGitHubRepositoryUrl('https://example.com/antvis/AVA')).toBe(false);
  });
});

describe('githubSince', () => {
  it.each([
    ['2026-01-01', '2026-01-01T00:00:00Z'],
    ['2026-01-01T08:30', '2026-01-01T08:30:00Z'],
    ['2026-01-01T08:30:15.250Z', '2026-01-01T08:30:15Z'],
    ['2026-01-01T08:00:00+08:00', '2026-01-01T00:00:00Z'],
  ])('normalizes %s to UTC', (input, expected) => {
    expect(githubSince(input)).toBe(expected);
  });

  it.each(['last week', '2026-13-01', '2026-02-30', '2026-01-01T25:00Z', '01/02/2026', '2026'])(
    'rejects %s',
    (input) => {
      expect(() => githubSince(input)).toThrow('Invalid GitHub "since" value');
    }
  );
});
