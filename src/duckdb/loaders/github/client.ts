/**
 * Read-only GitHub REST API client: token authentication, Link-header
 * pagination, and the retry rules GitHub documents for rate limits
 * (https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api)
 * and transient failures. Pages of one list are requested one after another.
 */

import { DEFAULT_GITHUB_API_URL, DEFAULT_MAX_RATE_LIMIT_WAIT_MS } from './options';

const API_VERSION = '2022-11-28';
const USER_AGENT = '@antv/ava';
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
/** Retries after network errors and 5xx responses, with 1s, 2s and 4s waits. */
const TRANSIENT_RETRIES = 3;
/** Retries after rate-limit responses; each wait must also fit maxRateLimitWaitMs. */
const RATE_LIMIT_RETRIES = 3;
/** GitHub asks clients to wait at least a minute after a secondary limit without retry-after. */
const SECONDARY_LIMIT_WAIT_MS = 60_000;

export type GitHubQuery = Record<string, string | number | undefined>;

export interface GitHubClientOptions {
  token?: string;
  apiUrl?: string;
  maxRateLimitWaitMs?: number;
}

/** Clock and timer hooks, replaced in tests. */
export interface GitHubClientRuntime {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A GitHub API failure with the HTTP status when GitHub answered. */
export class GitHubApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/** A rate limit whose reset is further away than maxRateLimitWaitMs. */
export class GitHubRateLimitError extends GitHubApiError {
  constructor(message: string, status: number | undefined, readonly resetAt: Date) {
    super(message, status);
    this.name = 'GitHubRateLimitError';
  }
}

interface ErrorDetail {
  message: string;
  documentationUrl?: string;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Path and query of an API URL; never contains credentials. */
function describe(url: URL): string {
  return `${url.pathname}${url.search}`;
}

function errorDetail(response: Response, text: string): ErrorDetail {
  try {
    const body = JSON.parse(text) as { message?: unknown; documentation_url?: unknown };
    return {
      message: typeof body?.message === 'string' && body.message ? body.message : response.statusText,
      documentationUrl: typeof body?.documentation_url === 'string' ? body.documentation_url : undefined,
    };
  } catch {
    return { message: response.statusText };
  }
}

interface GitHubResponse {
  body: unknown;
  headers: Headers;
}

/** Extract the rel="next" target from a Link header. */
export function nextLink(header: string | null): string | undefined {
  const links = /<([^>]+)>\s*;\s*rel="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while (header && (match = links.exec(header))) {
    if (match[2].split(/\s+/).includes('next')) return match[1];
  }
  return undefined;
}

export class GitHubClient {
  /** Number of HTTP requests sent, including retries. */
  requests = 0;

  private readonly apiUrl: URL;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Set when GitHub reports no remaining requests, so the next request waits instead of failing. */
  private exhausted: { resetAt: number; limit: string | null } | undefined;

  constructor(private readonly options: GitHubClientOptions = {}, runtime: GitHubClientRuntime = {}) {
    this.apiUrl = new URL((options.apiUrl ?? DEFAULT_GITHUB_API_URL).replace(/\/+$/, ''));
    this.maxWaitMs = options.maxRateLimitWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS;
    this.sleep = runtime.sleep ?? sleepFor;
    this.now = runtime.now ?? Date.now;
  }

  /** Build an API URL from a path such as `/repos/owner/name/issues`. */
  url(path: string, query: GitHubQuery = {}): URL {
    const url = new URL(`${this.apiUrl.href.replace(/\/+$/, '')}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  /** GET one JSON document. */
  async get<T = unknown>(path: string, query?: GitHubQuery): Promise<T> {
    return (await this.request(this.url(path, query))).body as T;
  }

  /**
   * GET every page of a list endpoint. Fails instead of truncating when the
   * list holds more than `maxRecords` items, so loaded tables are never partial.
   */
  async list<T = unknown>(
    path: string,
    query: GitHubQuery,
    limit: { maxRecords: number; description: string }
  ): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let url: URL | undefined = this.url(path, { per_page: PAGE_SIZE, ...query });

    while (url) {
      if (seen.has(url.href)) throw new GitHubApiError(`GitHub pagination repeated a page: ${describe(url)}`);
      seen.add(url.href);

      const { body: page, headers } = await this.request(url);
      if (!Array.isArray(page)) throw new GitHubApiError(`GitHub returned a non-list response for ${describe(url)}`);
      items.push(...(page as T[]));

      const next = nextLink(headers.get('link'));
      if (items.length > limit.maxRecords || (next && items.length >= limit.maxRecords)) {
        throw new GitHubApiError(
          `GitHub returned more than ${limit.maxRecords} records for ${limit.description}. ` +
            'Set "since" to load a shorter period, or raise "maxRecords".'
        );
      }
      url = next ? this.follow(next) : undefined;
    }
    return items;
  }

  /** Only follow pagination links on the API origin, so the token never leaves it. */
  private follow(link: string): URL {
    const url = new URL(link, this.apiUrl);
    if (url.origin !== this.apiUrl.origin) {
      throw new GitHubApiError(`GitHub pagination pointed outside ${this.apiUrl.origin}: ${url.origin}`);
    }
    return url;
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': API_VERSION,
      ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
    };
  }

  private async request(url: URL): Promise<GitHubResponse> {
    let transient = 0;
    let limited = 0;

    for (;;) {
      await this.waitForQuota(url);

      let response: Response;
      let text: string;
      try {
        this.requests += 1;
        response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        // Read the body here: a connection can also drop in the middle of it.
        text = await response.text();
      } catch (error) {
        if (transient < TRANSIENT_RETRIES) {
          await this.sleep(1000 * 2 ** transient++);
          continue;
        }
        throw new GitHubApiError(`GitHub request failed: GET ${describe(url)} (${reason(error)})`);
      }

      this.observe(response.headers);
      if (response.ok) {
        try {
          return { body: JSON.parse(text), headers: response.headers };
        } catch {
          throw new GitHubApiError(`GitHub returned invalid JSON for ${describe(url)}`, response.status);
        }
      }

      const detail = errorDetail(response, text);
      const wait = this.rateLimitWait(response, detail, limited);
      if (wait !== undefined) {
        if (wait > this.maxWaitMs || limited >= RATE_LIMIT_RETRIES) {
          throw this.rateLimitError(response, detail, wait, url);
        }
        limited += 1;
        await this.sleep(wait);
        this.exhausted = undefined;
        continue;
      }
      if (response.status >= 500 && transient < TRANSIENT_RETRIES) {
        await this.sleep(1000 * 2 ** transient++);
        continue;
      }
      throw this.httpError(response, detail, url);
    }
  }

  /** Remember an exhausted primary limit from the response headers. */
  private observe(headers: Headers): void {
    const reset = Number(headers.get('x-ratelimit-reset'));
    this.exhausted =
      headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0
        ? { resetAt: reset * 1000, limit: headers.get('x-ratelimit-limit') }
        : undefined;
  }

  /** Wait for an exhausted primary limit to reset before sending the next request. */
  private async waitForQuota(url: URL): Promise<void> {
    if (!this.exhausted) return;
    const wait = this.exhausted.resetAt - this.now() + 1000;
    if (wait <= 0) return;
    if (wait > this.maxWaitMs) {
      throw new GitHubRateLimitError(
        this.primaryLimitMessage(this.exhausted.limit, this.exhausted.resetAt, describe(url)),
        undefined,
        new Date(this.exhausted.resetAt)
      );
    }
    await this.sleep(wait);
  }

  /** Milliseconds to wait before retrying a rate-limited response, or undefined when it is not rate limited. */
  private rateLimitWait(response: Response, detail: ErrorDetail, attempt: number): number | undefined {
    const { headers, status } = response;
    const retryAfter = headers.get('retry-after');
    const remaining = headers.get('x-ratelimit-remaining');
    const limited =
      status === 429 ||
      (status === 403 && (remaining === '0' || retryAfter !== null || /rate limit/i.test(detail.message)));
    if (!limited) return undefined;

    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
      if (!Number.isNaN(date)) return Math.max(0, date - this.now());
    }
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (remaining === '0' && Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - this.now()) + 1000;
    return SECONDARY_LIMIT_WAIT_MS * 2 ** attempt;
  }

  private primaryLimitMessage(limit: string | null, resetAt: number, path: string): string {
    const quota = limit ? `${limit} requests per hour` : 'its hourly quota';
    const advice = this.options.token
      ? 'Wait for the reset, load fewer resources or a shorter "since" period, or raise "maxRateLimitWaitMs".'
      : 'Unauthenticated requests share 60 requests per hour per IP address; set a GitHub token to get 5,000 per hour.';
    return `GitHub API rate limit exceeded (${quota}) before GET ${path}; it resets at ${new Date(
      resetAt
    ).toISOString()}. ${advice}`;
  }

  private rateLimitError(response: Response, detail: ErrorDetail, wait: number, url: URL): GitHubRateLimitError {
    const { headers, status } = response;
    const path = describe(url);
    const reset = Number(headers.get('x-ratelimit-reset')) * 1000;
    if (headers.get('x-ratelimit-remaining') === '0' && reset > 0) {
      return new GitHubRateLimitError(
        this.primaryLimitMessage(headers.get('x-ratelimit-limit'), reset, path),
        status,
        new Date(reset)
      );
    }
    const resetAt = this.now() + wait;
    return new GitHubRateLimitError(
      `GitHub secondary rate limit hit (${status} ${detail.message}); retry after ${new Date(
        resetAt
      ).toISOString()}. Load fewer resources or raise "maxRateLimitWaitMs".`,
      status,
      new Date(resetAt)
    );
  }

  private httpError(response: Response, detail: ErrorDetail, url: URL): GitHubApiError {
    const path = describe(url);
    const docs = detail.documentationUrl ? ` See ${detail.documentationUrl}` : '';
    const status = `${response.status} ${detail.message}`;
    switch (response.status) {
      case 401:
        return new GitHubApiError(
          `GitHub rejected the token (${status}). Check that it is valid and has not expired.`,
          401
        );
      case 403: {
        const sso = response.headers.get('x-github-sso');
        if (sso) {
          const link = /url=(\S+)/.exec(sso)?.[1];
          return new GitHubApiError(
            `GitHub requires SAML single sign-on authorization for this token${
              link ? `: ${link}` : ''
            }. Authorize the token for the organization, then retry.`,
            403
          );
        }
        return new GitHubApiError(
          `GitHub denied GET ${path} (${status}). Check that the token can read this repository.${docs}`,
          403
        );
      }
      case 404:
        return new GitHubApiError(
          `GitHub returned 404 for GET ${path}. Check the repository name; private repositories need a token with read access.`,
          404
        );
      default:
        return new GitHubApiError(`GitHub request failed: GET ${path} (${status}).${docs}`, response.status);
    }
  }
}
