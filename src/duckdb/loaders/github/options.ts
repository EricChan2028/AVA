import { z } from 'zod';

import type { GitHubResource, GitHubSourceOptions } from '../../../types';

/** Resources that can be selected; `repositories` is always loaded. */
export const GITHUB_RESOURCES = ['issues', 'pull_requests', 'labels', 'milestones', 'releases', 'comments'] as const;

/** Resources loaded when `resources` is omitted: list endpoints only, one request per 100 items. */
export const DEFAULT_GITHUB_RESOURCES: GitHubResource[] = [
  'issues',
  'pull_requests',
  'labels',
  'milestones',
  'releases',
];

export const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
export const DEFAULT_MAX_RECORDS = 10_000;
export const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 60_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * Normalize `since` to the `YYYY-MM-DDTHH:MM:SSZ` form GitHub expects.
 * A date means UTC midnight; a timestamp without an offset is read as UTC.
 */
export function githubSince(value: string): string {
  const input = value.trim();
  const match = ISO_DATE.exec(input);
  const invalid = new Error(
    `Invalid GitHub "since" value "${value}". Use an ISO 8601 date or timestamp such as 2026-01-01.`
  );
  if (!match) throw invalid;

  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw invalid;

  const time = Date.parse(/T/i.test(input) && !match[4] ? `${input}Z` : input);
  if (Number.isNaN(time)) throw invalid;
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isSince(value: string): boolean {
  try {
    githubSince(value);
    return true;
  } catch {
    return false;
  }
}

const text = z.string().min(1);

/** Source options shared by the loader and the CLI session protocol. */
export const githubOptionsSchema = z
  .object({
    repository: z.union([text, z.array(text).nonempty()]),
    token: text.optional(),
    resources: z.array(z.enum(GITHUB_RESOURCES)).nonempty().optional(),
    since: text.refine(isSince, 'since must be an ISO 8601 date or timestamp, such as 2026-01-01').optional(),
    maxRecords: z.number().int().positive().optional(),
    apiUrl: text
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'apiUrl must be an http(s) URL')
      .optional(),
    maxRateLimitWaitMs: z.number().int().nonnegative().optional(),
  })
  .strict() as z.ZodType<GitHubSourceOptions>;
