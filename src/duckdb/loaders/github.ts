/**
 * GitHub loader: read repository data through the GitHub REST API and
 * materialize it as typed DuckDB tables with primary and foreign keys, so the
 * schema shows how issues, pull requests, labels, milestones, releases and
 * comments relate to their repository. Read-only; public repositories can be
 * read without a token.
 *
 * Every table is fetched completely through list endpoints (100 items per
 * request); a list longer than `maxRecords` fails the load instead of
 * producing a partial table. Repositories are read one after another, and the
 * lists of one repository concurrently, so at most five requests are in flight.
 */

import { getDuckDBSchema } from '../util/schema';
import { createTable } from '../util/table';

import { GitHubApiError, GitHubClient } from './github/client';
import { DEFAULT_GITHUB_RESOURCES, DEFAULT_MAX_RECORDS, githubOptionsSchema, githubSince } from './github/options';
import { parseGitHubRepository } from './github/repository';
import {
  commentRow,
  commentsTable,
  isApiObject,
  isPullRequest,
  issueRow,
  issuesTable,
  labelRow,
  labelsTable,
  milestoneRow,
  milestonesTable,
  pullRequestRow,
  pullRequestsTable,
  releaseRow,
  releasesTable,
  repositoriesTable,
  repositoryRow,
} from './github/tables';

import type { GitHubRepositoryRef } from './github/repository';
import type { TableDefinition } from '../util/table';
import type { GitHubResource, GitHubSourceOptions, LoadedSource } from '../../types';

type Row = Record<string, unknown>;
type Item = Record<string, unknown>;

/** A repository list endpoint and the tables its items fill. */
interface GitHubList {
  endpoint: string;
  query: Record<string, string>;
  description: string;
  /** GitHub filters this list by update time, so `since` applies. */
  filtersBySince: boolean;
  tables: {
    resource: GitHubResource;
    table: TableDefinition;
    row: (repository: string, item: Item) => Row;
    includes?: (item: Item) => boolean;
  }[];
}

const LISTS: GitHubList[] = [
  {
    endpoint: '/issues',
    query: { state: 'all', sort: 'created', direction: 'asc' },
    description: 'issues and pull requests',
    filtersBySince: true,
    // One endpoint lists both; an item with a pull_request field is a pull request.
    tables: [
      { resource: 'issues', table: issuesTable, row: issueRow, includes: (item) => !isPullRequest(item) },
      { resource: 'pull_requests', table: pullRequestsTable, row: pullRequestRow, includes: isPullRequest },
    ],
  },
  {
    endpoint: '/labels',
    query: {},
    description: 'labels',
    filtersBySince: false,
    tables: [{ resource: 'labels', table: labelsTable, row: labelRow }],
  },
  {
    endpoint: '/milestones',
    query: { state: 'all' },
    description: 'milestones',
    filtersBySince: false,
    tables: [{ resource: 'milestones', table: milestonesTable, row: milestoneRow }],
  },
  {
    endpoint: '/releases',
    query: {},
    description: 'releases',
    filtersBySince: false,
    tables: [{ resource: 'releases', table: releasesTable, row: releaseRow }],
  },
  {
    endpoint: '/issues/comments',
    query: { sort: 'created', direction: 'asc' },
    description: 'issue and pull request comments',
    filtersBySince: true,
    tables: [{ resource: 'comments', table: commentsTable, row: commentRow }],
  },
];

interface ReadContext {
  client: GitHubClient;
  resources: Set<GitHubResource>;
  since?: string;
  maxRecords: number;
  rows: Map<TableDefinition, Row[]>;
}

function add(context: ReadContext, table: TableDefinition, rows: Row[]): void {
  context.rows.set(table, [...(context.rows.get(table) ?? []), ...rows]);
}

/** Keep one row per primary key (the last one read) and drop rows without a key. */
function unique(table: TableDefinition, rows: Row[]): Row[] {
  const keyColumns = table.primaryKey ?? [];
  const byKey = new Map<string, Row>();
  for (const row of rows) {
    const key = keyColumns.map((column) => row[column]);
    if (key.some((value) => value === null || value === undefined)) continue;
    byKey.set(JSON.stringify(key), row);
  }
  return [...byKey.values()];
}

async function readRepository(context: ReadContext, ref: GitHubRepositoryRef, loaded: Set<string>): Promise<void> {
  const { client, resources, since, maxRecords } = context;
  const repo = await client.get(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`);
  if (!isApiObject(repo) || typeof repo.full_name !== 'string') {
    throw new GitHubApiError(`GitHub returned an invalid repository for ${ref.owner}/${ref.name}`);
  }
  // Renamed repositories redirect, so the canonical name may differ from the requested one.
  const fullName = repo.full_name;
  if (loaded.has(fullName)) return;
  loaded.add(fullName);
  add(context, repositoriesTable, [repositoryRow(repo)]);

  const path = `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`;
  await Promise.all(
    LISTS.map(async ({ endpoint, query, description, filtersBySince, tables }) => {
      const selected = tables.filter(({ resource }) => resources.has(resource));
      if (selected.length === 0) return;

      const window = filtersBySince ? since : undefined;
      const items = await client.list<unknown>(
        `${path}${endpoint}`,
        { ...query, since: window },
        { maxRecords, description: `${fullName} ${description}${window ? ` updated since ${window}` : ''}` }
      );
      const objects = items.filter(isApiObject);
      for (const { table, row, includes } of selected) {
        const rows = objects.filter((item) => !includes || includes(item)).map((item) => row(fullName, item));
        add(context, table, rows);
      }
    })
  );
}

export async function loadGitHub(options: GitHubSourceOptions): Promise<LoadedSource> {
  const parsed = githubOptionsSchema.parse(options);
  const refs = (Array.isArray(parsed.repository) ? parsed.repository : [parsed.repository]).map(parseGitHubRepository);
  const context: ReadContext = {
    client: new GitHubClient({
      token: parsed.token,
      apiUrl: parsed.apiUrl,
      maxRateLimitWaitMs: parsed.maxRateLimitWaitMs,
    }),
    resources: new Set(parsed.resources ?? DEFAULT_GITHUB_RESOURCES),
    since: parsed.since === undefined ? undefined : githubSince(parsed.since),
    maxRecords: parsed.maxRecords ?? DEFAULT_MAX_RECORDS,
    rows: new Map(),
  };

  const loaded = new Set<string>();
  for (const ref of refs) await readRepository(context, ref, loaded);

  // `repositories` comes first because every other table references it.
  const definitions = [repositoriesTable];
  for (const { tables } of LISTS) {
    for (const { resource, table } of tables) if (context.resources.has(resource)) definitions.push(table);
  }
  const tables = definitions.map((definition) => ({
    definition,
    rows: unique(definition, context.rows.get(definition) ?? []),
  }));
  const tableNames = definitions.map(({ name }) => name);

  return {
    register: async (conn) => {
      for (const { definition, rows } of tables) await createTable(conn, definition, rows);
      return tableNames;
    },
    getSchema: (conn) => getDuckDBSchema(conn, tableNames),
    // Rows are held in DuckDB memory, so the engine can disable file access entirely.
    allowedDirectories: [],
    cleanup: async () => {},
  };
}
