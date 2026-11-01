/**
 * A fictional GitHub repository served by a stubbed fetch, shaped like REST API
 * responses. Lists are paginated with Link headers, two items per page.
 */

import { vi } from 'vitest';

const user = (login: string, type = 'User') => ({ login, id: login.length, type });
const alice = user('alice');
const bob = user('bob');
const carol = user('carol');
const dependabot = user('dependabot[bot]', 'Bot');

const label = (name: string) => ({ id: name.length, name, color: 'ededed', default: name === 'bug' });

export const repository = {
  id: 1001,
  full_name: 'acme/widgets',
  name: 'widgets',
  owner: user('acme', 'Organization'),
  description: 'Widgets for dashboards',
  homepage: '',
  language: 'TypeScript',
  topics: ['charts', 'dashboard'],
  license: { key: 'mit', spdx_id: 'MIT' },
  visibility: 'public',
  fork: false,
  archived: false,
  default_branch: 'main',
  stargazers_count: 42,
  subscribers_count: 7,
  forks_count: 5,
  open_issues_count: 2,
  size: 512,
  created_at: '2025-01-15T03:00:00Z',
  updated_at: '2026-10-30T07:29:13Z',
  pushed_at: '2026-10-29T12:00:00Z',
  html_url: 'https://github.com/acme/widgets',
};

function item(number: number, fields: Record<string, unknown>) {
  return {
    id: 5000 + number,
    number,
    state: 'open',
    state_reason: null,
    user: bob,
    author_association: 'CONTRIBUTOR',
    assignees: [],
    labels: [],
    milestone: null,
    comments: 0,
    reactions: { total_count: 0, '+1': 0 },
    locked: false,
    closed_at: null,
    closed_by: null,
    html_url: `https://github.com/acme/widgets/${'pull_request' in fields ? 'pull' : 'issues'}/${number}`,
    ...fields,
  };
}

const pull = (mergedAt: string | null, draft = false) => ({ draft, pull_request: { merged_at: mergedAt } });

/** Issues and pull requests share one numbering and one list endpoint. */
export const items = [
  item(1, {
    title: 'Crash when the dataset is empty',
    state: 'closed',
    state_reason: 'completed',
    type: { id: 1, name: 'Bug' },
    labels: [label('bug')],
    milestone: { number: 1, title: 'v1.0' },
    comments: 2,
    reactions: { total_count: 3, '+1': 3 },
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-03T08:00:00Z',
    closed_at: '2026-09-03T08:00:00Z',
    closed_by: alice,
  }),
  item(2, {
    title: 'Fix crash on empty dataset',
    user: alice,
    author_association: 'MEMBER',
    state: 'closed',
    labels: [label('bug')],
    milestone: { number: 1, title: 'v1.0' },
    comments: 1,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T12:00:00Z',
    closed_at: '2026-09-02T12:00:00Z',
    closed_by: alice,
    ...pull('2026-09-02T12:00:00Z'),
  }),
  item(3, {
    title: 'Support a dark theme',
    user: carol,
    author_association: 'NONE',
    assignees: [alice],
    labels: [label('enhancement'), label('good first issue')],
    comments: 1,
    reactions: { total_count: 5, '+1': 4 },
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-12T00:00:00Z',
  }),
  item(4, {
    title: 'Bump vitest from 4.1.10 to 4.1.11',
    user: dependabot,
    state: 'closed',
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-12T00:00:00Z',
    closed_at: '2026-09-12T00:00:00Z',
    closed_by: alice,
    ...pull(null),
  }),
  item(5, {
    title: 'Add a dark theme',
    user: carol,
    author_association: 'FIRST_TIME_CONTRIBUTOR',
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-06T00:00:00Z',
    ...pull(null, true),
  }),
  item(6, {
    title: 'Typo in the docs',
    state: 'closed',
    state_reason: 'not_planned',
    labels: [label('documentation')],
    created_at: '2026-10-07T00:00:00Z',
    updated_at: '2026-10-08T00:00:00Z',
    closed_at: '2026-10-08T00:00:00Z',
    closed_by: alice,
  }),
];

export const labels = [
  { ...label('bug'), description: "Something isn't working" },
  { ...label('documentation'), description: null },
  { ...label('enhancement'), description: 'New feature or request' },
  { ...label('good first issue'), description: 'Good for newcomers' },
];

export const milestones = [
  {
    number: 1,
    title: 'v1.0',
    description: 'First stable release',
    state: 'closed',
    open_issues: 0,
    closed_issues: 2,
    due_on: '2026-09-30T07:00:00Z',
    creator: alice,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
    closed_at: '2026-09-05T00:00:00Z',
    html_url: 'https://github.com/acme/widgets/milestone/1',
  },
];

export const releases = [
  {
    id: 9001,
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    draft: false,
    prerelease: false,
    author: alice,
    created_at: '2026-09-05T00:00:00Z',
    published_at: '2026-09-05T01:00:00Z',
    assets: [{ download_count: 120 }, { download_count: 30 }],
    html_url: 'https://github.com/acme/widgets/releases/tag/v1.0.0',
  },
  {
    id: 9002,
    tag_name: 'v1.1.0-beta.1',
    name: 'v1.1.0 beta 1',
    draft: false,
    prerelease: true,
    author: alice,
    created_at: '2026-10-10T00:00:00Z',
    published_at: '2026-10-10T00:00:00Z',
    assets: [{ download_count: 5 }],
    html_url: 'https://github.com/acme/widgets/releases/tag/v1.1.0-beta.1',
  },
];

const comment = (id: number, number: number, author: typeof alice, association: string, createdAt: string) => ({
  id,
  user: author,
  author_association: association,
  issue_url: `https://api.github.com/repos/acme/widgets/issues/${number}`,
  html_url: `https://github.com/acme/widgets/${number === 2 ? 'pull' : 'issues'}/${number}#issuecomment-${id}`,
  reactions: { total_count: id === 7001 ? 2 : 0 },
  created_at: createdAt,
  updated_at: createdAt,
});

export const comments = [
  comment(7001, 1, alice, 'MEMBER', '2026-09-01T09:30:00Z'),
  comment(7002, 2, bob, 'CONTRIBUTOR', '2026-09-01T11:00:00Z'),
  comment(7003, 1, bob, 'CONTRIBUTOR', '2026-09-02T08:00:00Z'),
  comment(7004, 3, alice, 'MEMBER', '2026-09-12T00:00:00Z'),
];

export const widgetsRoutes: Record<string, unknown> = {
  '/repos/acme/widgets': repository,
  '/repos/acme/widgets/issues': items,
  '/repos/acme/widgets/labels': labels,
  '/repos/acme/widgets/milestones': milestones,
  '/repos/acme/widgets/releases': releases,
  '/repos/acme/widgets/issues/comments': comments,
};

export interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

/**
 * Stub fetch with a GitHub API that serves `routes` by path. Arrays are
 * paginated with Link headers; unknown paths return 404.
 */
export function mockGitHubApi(routes: Record<string, unknown>, pageSize = 2): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: { headers?: Record<string, string> }) => {
      const url = new URL(String(input));
      requests.push({ url, headers: { ...init?.headers } });
      // GitHub matches owner and repository names case-insensitively.
      const body = routes[url.pathname.toLowerCase()];
      if (body === undefined) {
        return Response.json(
          { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' },
          { status: 404 }
        );
      }
      if (!Array.isArray(body)) return Response.json(body);

      const page = Number(url.searchParams.get('page') ?? '1');
      const headers = new Headers({ 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' });
      if (page * pageSize < body.length) {
        const next = new URL(url);
        next.searchParams.set('page', String(page + 1));
        headers.set('link', `<${next.href}>; rel="next", <${next.href}>; rel="last"`);
      }
      return Response.json(body.slice((page - 1) * pageSize, page * pageSize), { headers });
    })
  );
  return requests;
}
