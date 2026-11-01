/**
 * GitHub resources as DuckDB tables: column types, keys, and the mapping from
 * REST API objects to rows. Timestamps are UTC, matching GitHub search
 * qualifiers such as `created:2026-10-01..2026-10-31`.
 */

import type { TableColumn, TableDefinition } from '../../util/table';

type ApiObject = Record<string, unknown>;
type Row = Record<string, unknown>;

export function isApiObject(value: unknown): value is ApiObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** ISO 8601 timestamp as a UTC `YYYY-MM-DD HH:MM:SS` string for a DuckDB TIMESTAMP. */
export function utcTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time)
    ? null
    : new Date(time)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');
}

function login(user: unknown): string | null {
  return isApiObject(user) ? nonEmpty(user.login) : null;
}

function isBot(user: unknown): boolean | null {
  return isApiObject(user) && typeof user.type === 'string' ? user.type === 'Bot' : null;
}

/** Names from a list of strings or objects, in API order. */
function names(values: unknown, key: string): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (isApiObject(value) ? nonEmpty(value[key]) : nonEmpty(value)))
    .filter((value): value is string => value !== null);
}

function reactions(item: ApiObject): number | null {
  return isApiObject(item.reactions) ? integer(item.reactions.total_count) : null;
}

const column = (name: string, type: string, notNull = false): TableColumn => ({ name, type, notNull });
/** Text with documented values; the table type also admits any other value GitHub returns. */
const category = (name: string, values: readonly string[], notNull = false): TableColumn => ({
  name,
  type: 'VARCHAR',
  notNull,
  values,
});
const repository = column('repository', 'VARCHAR', true);
const STATES = ['closed', 'open'];
const AUTHOR_ASSOCIATIONS = [
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIMER',
  'FIRST_TIME_CONTRIBUTOR',
  'MANNEQUIN',
  'MEMBER',
  'NONE',
  'OWNER',
];
const toRepository = { columns: ['repository'], table: 'repositories', referencedColumns: ['full_name'] };

export const repositoriesTable: TableDefinition = {
  name: 'repositories',
  columns: [
    column('full_name', 'VARCHAR', true),
    column('owner', 'VARCHAR', true),
    column('name', 'VARCHAR', true),
    column('description', 'VARCHAR'),
    column('homepage', 'VARCHAR'),
    column('language', 'VARCHAR'),
    column('topics', 'VARCHAR[]'),
    column('license', 'VARCHAR'),
    category('visibility', ['internal', 'private', 'public']),
    column('is_fork', 'BOOLEAN'),
    column('is_archived', 'BOOLEAN'),
    column('default_branch', 'VARCHAR'),
    column('stars', 'INTEGER'),
    column('watchers', 'INTEGER'),
    column('forks', 'INTEGER'),
    column('open_issues_and_pull_requests', 'INTEGER'),
    column('size_kb', 'INTEGER'),
    column('created_at', 'TIMESTAMP'),
    column('updated_at', 'TIMESTAMP'),
    column('pushed_at', 'TIMESTAMP'),
    column('html_url', 'VARCHAR'),
  ],
  primaryKey: ['full_name'],
};

/** Issues and pull requests come from the same endpoint and share most columns; state-specific ones go between. */
const itemColumns = {
  identity: [
    repository,
    column('number', 'INTEGER', true),
    column('title', 'VARCHAR'),
    category('state', STATES, true),
  ],
  details: [
    column('author', 'VARCHAR'),
    column('author_is_bot', 'BOOLEAN'),
    category('author_association', AUTHOR_ASSOCIATIONS),
    column('assignees', 'VARCHAR[]'),
    column('labels', 'VARCHAR[]'),
    column('milestone', 'VARCHAR'),
    column('comments', 'INTEGER'),
    column('reactions', 'INTEGER'),
    column('is_locked', 'BOOLEAN'),
    column('created_at', 'TIMESTAMP', true),
    column('updated_at', 'TIMESTAMP', true),
    column('closed_at', 'TIMESTAMP'),
  ],
};

export const issuesTable: TableDefinition = {
  name: 'issues',
  columns: [
    ...itemColumns.identity,
    category('state_reason', ['completed', 'duplicate', 'not_planned', 'reopened']),
    // Issue types are defined by each organization.
    category('issue_type', []),
    ...itemColumns.details,
    column('closed_by', 'VARCHAR'),
    column('html_url', 'VARCHAR'),
  ],
  primaryKey: ['repository', 'number'],
  foreignKeys: [toRepository],
};

export const pullRequestsTable: TableDefinition = {
  name: 'pull_requests',
  columns: [
    ...itemColumns.identity,
    column('is_draft', 'BOOLEAN'),
    column('is_merged', 'BOOLEAN'),
    ...itemColumns.details,
    column('merged_at', 'TIMESTAMP'),
    column('closed_by', 'VARCHAR'),
    column('html_url', 'VARCHAR'),
  ],
  primaryKey: ['repository', 'number'],
  foreignKeys: [toRepository],
};

export const labelsTable: TableDefinition = {
  name: 'labels',
  columns: [
    repository,
    column('name', 'VARCHAR', true),
    column('description', 'VARCHAR'),
    column('color', 'VARCHAR'),
    column('is_default', 'BOOLEAN'),
  ],
  primaryKey: ['repository', 'name'],
  foreignKeys: [toRepository],
};

export const milestonesTable: TableDefinition = {
  name: 'milestones',
  columns: [
    repository,
    column('number', 'INTEGER', true),
    column('title', 'VARCHAR'),
    column('description', 'VARCHAR'),
    category('state', STATES),
    column('open_issues', 'INTEGER'),
    column('closed_issues', 'INTEGER'),
    column('due_on', 'TIMESTAMP'),
    column('creator', 'VARCHAR'),
    column('created_at', 'TIMESTAMP'),
    column('updated_at', 'TIMESTAMP'),
    column('closed_at', 'TIMESTAMP'),
    column('html_url', 'VARCHAR'),
  ],
  primaryKey: ['repository', 'number'],
  foreignKeys: [toRepository],
};

export const releasesTable: TableDefinition = {
  name: 'releases',
  columns: [
    repository,
    column('id', 'BIGINT', true),
    column('tag_name', 'VARCHAR'),
    column('name', 'VARCHAR'),
    column('is_draft', 'BOOLEAN'),
    column('is_prerelease', 'BOOLEAN'),
    column('author', 'VARCHAR'),
    column('created_at', 'TIMESTAMP'),
    column('published_at', 'TIMESTAMP'),
    column('assets', 'INTEGER'),
    column('downloads', 'BIGINT'),
    column('html_url', 'VARCHAR'),
  ],
  primaryKey: ['id'],
  foreignKeys: [toRepository],
};

export const commentsTable: TableDefinition = {
  name: 'comments',
  columns: [
    repository,
    column('id', 'BIGINT', true),
    column('number', 'INTEGER', true),
    column('is_pull_request', 'BOOLEAN'),
    column('author', 'VARCHAR'),
    column('author_is_bot', 'BOOLEAN'),
    category('author_association', AUTHOR_ASSOCIATIONS),
    column('reactions', 'INTEGER'),
    column('created_at', 'TIMESTAMP', true),
    column('updated_at', 'TIMESTAMP'),
    column('html_url', 'VARCHAR'),
  ],
  primaryKey: ['id'],
  foreignKeys: [toRepository],
};

export function repositoryRow(repo: ApiObject): Row {
  return {
    full_name: text(repo.full_name),
    owner: login(repo.owner),
    name: text(repo.name),
    description: nonEmpty(repo.description),
    homepage: nonEmpty(repo.homepage),
    language: nonEmpty(repo.language),
    topics: names(repo.topics, 'name'),
    license: isApiObject(repo.license) ? nonEmpty(repo.license.spdx_id) : null,
    visibility: nonEmpty(repo.visibility),
    is_fork: flag(repo.fork),
    is_archived: flag(repo.archived),
    default_branch: nonEmpty(repo.default_branch),
    stars: integer(repo.stargazers_count),
    watchers: integer(repo.subscribers_count),
    forks: integer(repo.forks_count),
    open_issues_and_pull_requests: integer(repo.open_issues_count),
    size_kb: integer(repo.size),
    created_at: utcTimestamp(repo.created_at),
    updated_at: utcTimestamp(repo.updated_at),
    pushed_at: utcTimestamp(repo.pushed_at),
    html_url: nonEmpty(repo.html_url),
  };
}

/** Whether an item from the issues endpoint is a pull request. */
export function isPullRequest(item: ApiObject): boolean {
  return isApiObject(item.pull_request);
}

function itemRow(fullName: string, item: ApiObject): Row {
  return {
    repository: fullName,
    number: integer(item.number),
    title: text(item.title),
    state: nonEmpty(item.state),
    author: login(item.user),
    author_is_bot: isBot(item.user),
    author_association: nonEmpty(item.author_association),
    assignees: names(item.assignees, 'login'),
    labels: names(item.labels, 'name'),
    milestone: isApiObject(item.milestone) ? nonEmpty(item.milestone.title) : null,
    comments: integer(item.comments),
    reactions: reactions(item),
    is_locked: flag(item.locked),
    created_at: utcTimestamp(item.created_at),
    updated_at: utcTimestamp(item.updated_at),
    closed_at: utcTimestamp(item.closed_at),
    closed_by: login(item.closed_by),
    html_url: nonEmpty(item.html_url),
  };
}

export function issueRow(fullName: string, item: ApiObject): Row {
  return {
    ...itemRow(fullName, item),
    state_reason: nonEmpty(item.state_reason),
    issue_type: isApiObject(item.type) ? nonEmpty(item.type.name) : null,
  };
}

/** As on GitHub, a merged pull request is closed; `is_merged` tells merged ones apart. */
export function pullRequestRow(fullName: string, item: ApiObject): Row {
  const mergedAt = isApiObject(item.pull_request) ? utcTimestamp(item.pull_request.merged_at) : null;
  return { ...itemRow(fullName, item), is_draft: flag(item.draft), is_merged: mergedAt !== null, merged_at: mergedAt };
}

export function labelRow(fullName: string, label: ApiObject): Row {
  return {
    repository: fullName,
    name: text(label.name),
    description: nonEmpty(label.description),
    color: nonEmpty(label.color),
    is_default: flag(label.default),
  };
}

export function milestoneRow(fullName: string, milestone: ApiObject): Row {
  return {
    repository: fullName,
    number: integer(milestone.number),
    title: text(milestone.title),
    description: nonEmpty(milestone.description),
    state: nonEmpty(milestone.state),
    open_issues: integer(milestone.open_issues),
    closed_issues: integer(milestone.closed_issues),
    due_on: utcTimestamp(milestone.due_on),
    creator: login(milestone.creator),
    created_at: utcTimestamp(milestone.created_at),
    updated_at: utcTimestamp(milestone.updated_at),
    closed_at: utcTimestamp(milestone.closed_at),
    html_url: nonEmpty(milestone.html_url),
  };
}

export function releaseRow(fullName: string, release: ApiObject): Row {
  const assets = Array.isArray(release.assets) ? release.assets.filter(isApiObject) : [];
  return {
    repository: fullName,
    id: integer(release.id),
    tag_name: nonEmpty(release.tag_name),
    name: nonEmpty(release.name),
    is_draft: flag(release.draft),
    is_prerelease: flag(release.prerelease),
    author: login(release.author),
    created_at: utcTimestamp(release.created_at),
    published_at: utcTimestamp(release.published_at),
    assets: assets.length,
    downloads: assets.reduce((sum, asset) => sum + (integer(asset.download_count) ?? 0), 0),
    html_url: nonEmpty(release.html_url),
  };
}

/** Issue and pull request comments share one endpoint; the page link tells them apart. */
export function commentRow(fullName: string, comment: ApiObject): Row {
  const issueUrl = text(comment.issue_url) ?? '';
  const htmlUrl = nonEmpty(comment.html_url);
  return {
    repository: fullName,
    id: integer(comment.id),
    number: integer(Number(/\/issues\/(\d+)$/.exec(issueUrl)?.[1])),
    is_pull_request: htmlUrl ? /\/pull\/\d+/.test(htmlUrl) : null,
    author: login(comment.user),
    author_is_bot: isBot(comment.user),
    author_association: nonEmpty(comment.author_association),
    reactions: reactions(comment),
    created_at: utcTimestamp(comment.created_at),
    updated_at: utcTimestamp(comment.updated_at),
    html_url: htmlUrl,
  };
}
