/**
 * GitHub loader against a stubbed REST API: tables, keys, relationships,
 * pagination, filters and failures, queried through the DuckDB engine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AVA } from '../../../src';
import { loadGitHub } from '../../../src/duckdb/loaders/github';

import { mockGitHubApi, repository, widgetsRoutes } from './github-fixtures';

const llm = { model: 'no-model-call' };
const allResources = ['issues', 'pull_requests', 'labels', 'milestones', 'releases', 'comments'] as const;

let ava: AVA | undefined;

afterEach(async () => {
  await ava?.dispose();
  ava = undefined;
  vi.unstubAllGlobals();
});

async function load(options: Record<string, unknown> = {}) {
  ava = new AVA({ llm });
  await ava.source({
    type: 'github',
    options: { repository: 'acme/widgets', resources: [...allResources], ...options },
  });
  return ava;
}

async function rows(sql: string) {
  return (await ava!.query(sql, { maxRows: 1000 })).data;
}

describe('loaders/github', () => {
  it('loads every resource as a table with keys and relationships', async () => {
    mockGitHubApi(widgetsRoutes);
    const schema = await (await load()).schema();

    expect(schema.models.map((model) => [model.name, model.primaryKey])).toEqual([
      ['comments', 'id'],
      ['issues', ['repository', 'number']],
      ['labels', ['repository', 'name']],
      ['milestones', ['repository', 'number']],
      ['pull_requests', ['repository', 'number']],
      ['releases', 'id'],
      ['repositories', 'full_name'],
    ]);
    expect(schema.relationships).toHaveLength(6);
    expect(schema.relationships).toContainEqual(
      expect.objectContaining({
        models: ['issues', 'repositories'],
        joinType: 'MANY_TO_ONE',
        condition: '"issues"."repository" = "repositories"."full_name"',
      })
    );
    const issues = schema.models.find((model) => model.name === 'issues')!;
    expect(issues.columns).toContainEqual({ name: 'labels', type: 'VARCHAR[]', notNull: false });
    expect(issues.columns).toContainEqual({ name: 'created_at', type: 'TIMESTAMP', notNull: true });
    // Categorical columns are ENUMs, so the schema shows their values.
    expect(issues.columns).toContainEqual({ name: 'state', type: "ENUM('closed', 'open')", notNull: true });
    expect(issues.columns).toContainEqual({
      name: 'state_reason',
      type: "ENUM('completed', 'duplicate', 'not_planned', 'reopened')",
      notNull: false,
    });
    expect(issues.columns).toContainEqual({ name: 'issue_type', type: "ENUM('Bug')", notNull: false });
    expect(issues.columns).toContainEqual({
      name: 'author_association',
      type: "ENUM('COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'MEMBER', 'NONE', 'OWNER')",
      notNull: false,
    });
  });

  it('splits issues from pull requests and keeps GitHub values', async () => {
    mockGitHubApi(widgetsRoutes);
    await load();

    expect(
      await rows(`SELECT number, state, state_reason, issue_type, author, labels, milestone, reactions,
        strftime(created_at, '%Y-%m-%d %H:%M:%S') AS created, closed_by FROM issues ORDER BY number`)
    ).toEqual([
      {
        number: 1,
        state: 'closed',
        state_reason: 'completed',
        issue_type: 'Bug',
        author: 'bob',
        labels: ['bug'],
        milestone: 'v1.0',
        reactions: 3,
        created: '2026-09-01 08:00:00',
        closed_by: 'alice',
      },
      {
        number: 3,
        state: 'open',
        state_reason: null,
        issue_type: null,
        author: 'carol',
        labels: ['enhancement', 'good first issue'],
        milestone: null,
        reactions: 5,
        created: '2026-09-10 00:00:00',
        closed_by: null,
      },
      {
        number: 6,
        state: 'closed',
        state_reason: 'not_planned',
        issue_type: null,
        author: 'bob',
        labels: ['documentation'],
        milestone: null,
        reactions: 0,
        created: '2026-10-07 00:00:00',
        closed_by: 'alice',
      },
    ]);
    expect(
      await rows(`SELECT number, state, is_merged, is_draft, author, author_is_bot, author_association,
        date_diff('hour', created_at, merged_at) AS hours_to_merge FROM pull_requests ORDER BY number`)
    ).toEqual([
      {
        number: 2,
        state: 'closed',
        is_merged: true,
        is_draft: false,
        author: 'alice',
        author_is_bot: false,
        author_association: 'MEMBER',
        hours_to_merge: 26,
      },
      {
        number: 4,
        state: 'closed',
        is_merged: false,
        is_draft: false,
        author: 'dependabot[bot]',
        author_is_bot: true,
        author_association: 'CONTRIBUTOR',
        hours_to_merge: null,
      },
      {
        number: 5,
        state: 'open',
        is_merged: false,
        is_draft: true,
        author: 'carol',
        author_is_bot: false,
        author_association: 'FIRST_TIME_CONTRIBUTOR',
        hours_to_merge: null,
      },
    ]);
  });

  it('loads repository metadata, labels, milestones, releases and comments', async () => {
    mockGitHubApi(widgetsRoutes);
    await load();

    expect(
      await rows('SELECT full_name, owner, stars, open_issues_and_pull_requests, topics, license FROM repositories')
    ).toEqual([
      {
        full_name: 'acme/widgets',
        owner: 'acme',
        stars: 42,
        open_issues_and_pull_requests: 2,
        topics: ['charts', 'dashboard'],
        license: 'MIT',
      },
    ]);
    expect(await rows('SELECT name, is_default FROM labels ORDER BY name')).toEqual([
      { name: 'bug', is_default: true },
      { name: 'documentation', is_default: false },
      { name: 'enhancement', is_default: false },
      { name: 'good first issue', is_default: false },
    ]);
    expect(await rows('SELECT title, state, closed_issues FROM milestones')).toEqual([
      { title: 'v1.0', state: 'closed', closed_issues: 2 },
    ]);
    expect(await rows('SELECT tag_name, is_prerelease, assets, downloads FROM releases ORDER BY tag_name')).toEqual([
      { tag_name: 'v1.0.0', is_prerelease: false, assets: 2, downloads: 150 },
      { tag_name: 'v1.1.0-beta.1', is_prerelease: true, assets: 1, downloads: 5 },
    ]);
    expect(await rows('SELECT id, number, is_pull_request, author FROM comments ORDER BY id')).toEqual([
      { id: 7001, number: 1, is_pull_request: false, author: 'alice' },
      { id: 7002, number: 2, is_pull_request: true, author: 'bob' },
      { id: 7003, number: 1, is_pull_request: false, author: 'bob' },
      { id: 7004, number: 3, is_pull_request: false, author: 'alice' },
    ]);
  });

  it('answers response-time questions by joining comments to issues', async () => {
    mockGitHubApi(widgetsRoutes);
    await load();

    expect(
      await rows(`SELECT i.number, min(date_diff('minute', i.created_at, c.created_at)) AS minutes
        FROM issues i JOIN comments c ON c.repository = i.repository AND c.number = i.number AND c.author <> i.author
        GROUP BY i.number ORDER BY i.number`)
    ).toEqual([
      { number: 1, minutes: 90 },
      { number: 3, minutes: 2880 },
    ]);
  });

  it('follows pagination and sends list filters, the token and API headers', async () => {
    const requests = mockGitHubApi(widgetsRoutes);
    await load({ token: 'secret-token', since: '2026-09-01' });

    const issuePages = requests.filter(({ url }) => url.pathname === '/repos/acme/widgets/issues');
    expect(issuePages.map(({ url }) => url.searchParams.get('page'))).toEqual([null, '2', '3']);
    expect(Object.fromEntries(issuePages[0].url.searchParams)).toEqual({
      per_page: '100',
      state: 'all',
      sort: 'created',
      direction: 'asc',
      since: '2026-09-01T00:00:00Z',
    });
    const commentPage = requests.find(({ url }) => url.pathname === '/repos/acme/widgets/issues/comments')!;
    expect(commentPage.url.searchParams.get('since')).toBe('2026-09-01T00:00:00Z');
    const labelPage = requests.find(({ url }) => url.pathname === '/repos/acme/widgets/labels')!;
    expect(labelPage.url.searchParams.has('since')).toBe(false);
    for (const { headers } of requests) {
      expect(headers).toMatchObject({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer secret-token',
        'X-GitHub-Api-Version': '2022-11-28',
      });
      expect(headers['User-Agent']).toBeTruthy();
    }
  });

  it('loads only the selected resources and sends no token by default', async () => {
    const requests = mockGitHubApi(widgetsRoutes);
    const schema = await (await load({ resources: ['pull_requests'] })).schema();

    expect(schema.models.map((model) => model.name)).toEqual(['pull_requests', 'repositories']);
    expect(await rows('SELECT count(*) AS n FROM pull_requests')).toEqual([{ n: 3 }]);
    expect(requests.map(({ url }) => url.pathname)).not.toContain('/repos/acme/widgets/labels');
    expect(requests.every(({ headers }) => !('Authorization' in headers))).toBe(true);
  });

  it('loads the default resources when none are selected', async () => {
    mockGitHubApi(widgetsRoutes);
    ava = new AVA({ llm });
    await ava.source({ type: 'github', options: { repository: 'https://github.com/acme/widgets/issues' } });

    expect((await ava.schema()).models.map((model) => model.name)).toEqual([
      'issues',
      'labels',
      'milestones',
      'pull_requests',
      'releases',
      'repositories',
    ]);
  });

  it('uses the canonical repository name and loads a repository named twice once', async () => {
    const requests = mockGitHubApi(widgetsRoutes);
    await load({ repository: ['ACME/Widgets', 'https://github.com/acme/widgets.git'], resources: ['issues'] });

    expect(await rows('SELECT DISTINCT repository FROM issues')).toEqual([{ repository: 'acme/widgets' }]);
    expect(await rows('SELECT count(*) AS n FROM repositories')).toEqual([{ n: 1 }]);
    expect(requests.filter(({ url }) => url.pathname === '/repos/acme/widgets/issues')).toHaveLength(3);
  });

  it('combines several repositories in the same tables', async () => {
    mockGitHubApi({
      ...widgetsRoutes,
      '/repos/acme/gadgets': { ...repository, id: 1002, full_name: 'acme/gadgets', name: 'gadgets' },
      '/repos/acme/gadgets/issues': [
        {
          number: 1,
          title: 'Gadget issue',
          state: 'open',
          user: { login: 'dave', type: 'User' },
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
    });
    await load({ repository: ['acme/widgets', 'acme/gadgets'], resources: ['issues'] });

    expect(await rows('SELECT repository, count(*) AS issues FROM issues GROUP BY ALL ORDER BY repository')).toEqual([
      { repository: 'acme/gadgets', issues: 1 },
      { repository: 'acme/widgets', issues: 3 },
    ]);
  });

  it('creates empty tables for repositories without data', async () => {
    mockGitHubApi({
      '/repos/acme/widgets': repository,
      '/repos/acme/widgets/issues': [],
      '/repos/acme/widgets/labels': [],
    });
    await load({ resources: ['issues', 'pull_requests', 'labels'] });

    expect(
      await rows('SELECT (SELECT count(*) FROM issues) AS issues, (SELECT count(*) FROM pull_requests) AS pulls')
    ).toEqual([{ issues: 0, pulls: 0 }]);
  });

  it('keeps the last copy of an item listed twice while paginating', async () => {
    const [first] = widgetsRoutes['/repos/acme/widgets/issues'] as Record<string, unknown>[];
    mockGitHubApi({
      ...widgetsRoutes,
      '/repos/acme/widgets/issues': [first, { ...first, title: 'Renamed while paging' }],
    });
    await load({ resources: ['issues'] });

    expect(await rows('SELECT number, title FROM issues')).toEqual([{ number: 1, title: 'Renamed while paging' }]);
  });

  it('profiles the loaded tables', async () => {
    mockGitHubApi(widgetsRoutes);
    const profile = await (await load()).profile();

    const model = (name: string) => profile.models.find((entry) => entry.name === name)!;
    const metrics = (table: string, name: string) =>
      model(table).columns.find((column) => column.name === name)!.metrics;
    expect(profile.models.map((entry) => [entry.name, entry.metrics.row_count])).toEqual([
      ['comments', 4],
      ['issues', 3],
      ['labels', 4],
      ['milestones', 1],
      ['pull_requests', 3],
      ['releases', 2],
      ['repositories', 1],
    ]);
    expect(metrics('issues', 'created_at')).toMatchObject({ min: Date.parse('2026-09-01T08:00:00Z'), null_count: 0 });
    expect(metrics('issues', 'labels')).toMatchObject({ null_count: 0 });
    expect(metrics('comments', 'author_association').top_values).toEqual([
      { value: 'CONTRIBUTOR', count: 2 },
      { value: 'MEMBER', count: 2 },
    ]);
  });

  it('keeps the local file system closed to generated SQL', async () => {
    mockGitHubApi(widgetsRoutes);
    await load({ resources: ['issues'] });

    await expect(ava!.query("SELECT * FROM read_text('/etc/hostname')")).rejects.toThrow();
  });

  it('fails instead of loading a partial list', async () => {
    mockGitHubApi(widgetsRoutes);

    await expect(load({ resources: ['issues'], maxRecords: 3 })).rejects.toThrow(
      'GitHub returned more than 3 records for acme/widgets issues and pull requests.'
    );
  });

  it('reports a repository that does not exist or is not accessible', async () => {
    mockGitHubApi(widgetsRoutes);

    await expect(load({ repository: 'acme/missing' })).rejects.toThrow(
      'GitHub returned 404 for GET /repos/acme/missing. Check the repository name; private repositories need a token with read access.'
    );
  });

  it('validates options before sending requests', async () => {
    const requests = mockGitHubApi(widgetsRoutes);

    await expect(loadGitHub({ repository: 'acme' })).rejects.toThrow('Invalid GitHub repository "acme"');
    await expect(loadGitHub({ repository: 'acme/widgets', since: 'last week' })).rejects.toThrow('since');
    await expect(loadGitHub({ repository: 'acme/widgets', resources: ['stars' as any] })).rejects.toThrow();
    await expect(loadGitHub({ repository: 'https://gitlab.com/acme/widgets' })).rejects.toThrow('github.com');
    expect(requests).toHaveLength(0);
  });
});
