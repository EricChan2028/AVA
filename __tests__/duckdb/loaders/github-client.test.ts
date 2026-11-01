/**
 * GitHub REST client: pagination, rate limits, retries and error messages.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubApiError,
  GitHubClient,
  GitHubRateLimitError,
  nextLink,
} from '../../../src/duckdb/loaders/github/client';

import type { GitHubClientOptions } from '../../../src/duckdb/loaders/github/client';

const START = Date.parse('2026-11-01T00:00:00Z');
const resetIn = (seconds: number) => String(Math.floor(START / 1000) + seconds);

type Reply = Response | Error;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

/** A client whose fetch answers with `replies` in order and whose sleeps advance a fake clock. */
function client(replies: Reply[], options: GitHubClientOptions = {}) {
  const urls: string[] = [];
  const waits: number[] = [];
  let clock = START;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      urls.push(String(input));
      const reply = replies.shift();
      if (!reply) throw new Error('unexpected request');
      if (reply instanceof Error) throw reply;
      return reply;
    })
  );
  const github = new GitHubClient(options, {
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return { github, urls, waits };
}

afterEach(() => vi.unstubAllGlobals());

describe('nextLink', () => {
  it('finds rel="next" among several links', () => {
    expect(
      nextLink('<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel="next"')
    ).toBe('https://api.github.com/x?page=3');
    expect(nextLink('<https://api.github.com/x?page=9>; rel="last"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
  });
});

describe('GitHubClient.list', () => {
  const limit = { maxRecords: 10, description: 'acme/widgets labels' };

  it('requests 100 items per page and follows next links', async () => {
    const { github, urls } = client([
      json([1, 2], 200, { link: '<https://api.github.com/repos/acme/widgets/labels?per_page=100&page=2>; rel="next"' }),
      json([3]),
    ]);

    expect(await github.list('/repos/acme/widgets/labels', { state: 'all', since: undefined }, limit)).toEqual([
      1, 2, 3,
    ]);
    expect(urls).toEqual([
      'https://api.github.com/repos/acme/widgets/labels?per_page=100&state=all',
      'https://api.github.com/repos/acme/widgets/labels?per_page=100&page=2',
    ]);
    expect(github.requests).toBe(2);
  });

  it('keeps the base path of a GitHub Enterprise Server API URL', async () => {
    const { github, urls } = client([json([])], { apiUrl: 'https://github.example.com/api/v3/' });

    await github.list('/repos/acme/widgets/labels', {}, limit);
    expect(urls).toEqual(['https://github.example.com/api/v3/repos/acme/widgets/labels?per_page=100']);
  });

  it('never follows a pagination link to another origin', async () => {
    const { github } = client([json([1], 200, { link: '<https://attacker.example/steal?page=2>; rel="next"' })], {
      token: 'secret',
    });

    await expect(github.list('/repos/acme/widgets/labels', {}, limit)).rejects.toThrow(
      'GitHub pagination pointed outside https://api.github.com'
    );
  });

  it('stops when a page links to itself', async () => {
    const self = '<https://api.github.com/repos/acme/widgets/labels?per_page=100>; rel="next"';
    const { github } = client([json([1], 200, { link: self })]);

    await expect(github.list('/repos/acme/widgets/labels', {}, limit)).rejects.toThrow('repeated a page');
  });

  it('fails when the list is longer than maxRecords, but not when it ends exactly there', async () => {
    const next = { link: '<https://api.github.com/repos/acme/widgets/labels?page=2>; rel="next"' };
    let { github } = client([json([1, 2], 200, next)]);
    await expect(github.list('/repos/acme/widgets/labels', {}, { ...limit, maxRecords: 2 })).rejects.toThrow(
      'GitHub returned more than 2 records for acme/widgets labels. Set "since" to load a shorter period, or raise "maxRecords".'
    );

    ({ github } = client([json([1, 2])]));
    expect(await github.list('/repos/acme/widgets/labels', {}, { ...limit, maxRecords: 2 })).toEqual([1, 2]);
  });

  it('rejects responses that are not lists', async () => {
    const { github } = client([json({ message: 'ok' })]);

    await expect(github.list('/repos/acme/widgets/labels', {}, limit)).rejects.toThrow('non-list response');
  });
});

describe('GitHubClient rate limits', () => {
  it('waits for the primary limit to reset, then retries', async () => {
    const { github, waits } = client([
      json({ message: 'API rate limit exceeded for 203.0.113.7.' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '60',
        'x-ratelimit-reset': resetIn(30),
      }),
      json({ full_name: 'acme/widgets' }),
    ]);

    expect(await github.get('/repos/acme/widgets')).toEqual({ full_name: 'acme/widgets' });
    expect(waits).toEqual([31_000]);
  });

  it('fails with the reset time when the limit resets after maxRateLimitWaitMs', async () => {
    const { github, urls } = client([
      json({ message: 'API rate limit exceeded for 203.0.113.7.' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '60',
        'x-ratelimit-reset': resetIn(1800),
      }),
    ]);

    const error = await github.get('/repos/acme/widgets').catch((caught) => caught);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect(error.message).toBe(
      'GitHub API rate limit exceeded (60 requests per hour) before GET /repos/acme/widgets; it resets at ' +
        '2026-11-01T00:30:00.000Z. Unauthenticated requests share 60 requests per hour per IP address; ' +
        'set a GitHub token to get 5,000 per hour.'
    );
    expect(error.resetAt).toEqual(new Date('2026-11-01T00:30:00.000Z'));
    expect(urls).toHaveLength(1);
  });

  it('suggests narrower loads when a token has used its quota', async () => {
    const { github } = client(
      [
        json({ message: 'API rate limit exceeded' }, 429, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': resetIn(600),
        }),
      ],
      { token: 'secret' }
    );

    await expect(github.get('/repos/acme/widgets')).rejects.toThrow('raise "maxRateLimitWaitMs"');
  });

  it('waits before the next request once the quota is used up', async () => {
    const { github, waits, urls } = client([
      json({}, 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetIn(10) }),
      json({}),
    ]);

    await github.get('/a');
    expect(waits).toEqual([]);
    await github.get('/b');
    expect(waits).toEqual([11_000]);
    expect(urls).toHaveLength(2);
  });

  it('does not send a request that would exceed the quota before the reset', async () => {
    const { github, urls } = client([
      json({}, 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetIn(3600) }),
    ]);

    await github.get('/a');
    await expect(github.get('/b')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(urls).toHaveLength(1);
  });

  it('honors retry-after on secondary rate limits', async () => {
    const { github, waits } = client([
      json({ message: 'You have exceeded a secondary rate limit.' }, 403, { 'retry-after': '5' }),
      json({ ok: true }),
    ]);

    expect(await github.get('/repos/acme/widgets')).toEqual({ ok: true });
    expect(waits).toEqual([5_000]);
  });

  it('waits a minute after a secondary limit without retry-after', async () => {
    const replies = () => [json({ message: 'You have exceeded a secondary rate limit.' }, 403), json({ ok: true })];

    const { github, waits } = client(replies());
    expect(await github.get('/x')).toEqual({ ok: true });
    expect(waits).toEqual([60_000]);

    const short = client(replies(), { maxRateLimitWaitMs: 30_000 });
    await expect(short.github.get('/x')).rejects.toThrow(
      'GitHub secondary rate limit hit (403 You have exceeded a secondary rate limit.); retry after'
    );
  });

  it('gives up after repeated rate limits', async () => {
    const limited = () => json({ message: 'secondary rate limit' }, 429, { 'retry-after': '1' });
    const { github, waits } = client([limited(), limited(), limited(), limited()]);

    await expect(github.get('/x')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(waits).toEqual([1_000, 1_000, 1_000]);
  });
});

describe('GitHubClient failures', () => {
  it('retries server errors and network failures with backoff', async () => {
    const { github, waits } = client([
      json({ message: 'Server Error' }, 502),
      new TypeError('fetch failed'),
      json({ message: 'Unavailable' }, 503),
      json({ ok: true }),
    ]);

    expect(await github.get('/x')).toEqual({ ok: true });
    expect(waits).toEqual([1_000, 2_000, 4_000]);
  });

  it('retries a response whose body is cut off', async () => {
    const cutOff = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('terminated'));
        },
      })
    );
    const { github, waits } = client([cutOff, json({ ok: true })]);

    expect(await github.get('/x')).toEqual({ ok: true });
    expect(waits).toEqual([1_000]);
  });

  it('reports a network failure after the retries', async () => {
    const failure = () => new TypeError('fetch failed');
    const { github } = client([failure(), failure(), failure(), failure()]);

    await expect(github.get('/repos/acme/widgets')).rejects.toThrow(
      'GitHub request failed: GET /repos/acme/widgets (fetch failed)'
    );
  });

  it.each([
    [401, { message: 'Bad credentials' }, {}, 'GitHub rejected the token (401 Bad credentials).'],
    [
      403,
      { message: 'Resource protected by organization SAML enforcement.' },
      { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=abc' },
      'GitHub requires SAML single sign-on authorization for this token: https://github.com/orgs/acme/sso?authorization_request=abc.',
    ],
    [
      403,
      {
        message: 'Resource not accessible by personal access token',
        documentation_url: 'https://docs.github.com/rest',
      },
      {},
      'GitHub denied GET /x (403 Resource not accessible by personal access token). Check that the token can read this repository. See https://docs.github.com/rest',
    ],
    [404, { message: 'Not Found' }, {}, 'GitHub returned 404 for GET /x.'],
    [
      422,
      { message: 'Validation Failed', documentation_url: 'https://docs.github.com/rest' },
      {},
      'GitHub request failed: GET /x (422 Validation Failed). See https://docs.github.com/rest',
    ],
  ])('explains HTTP %i responses', async (status, body, headers, message) => {
    const { github, waits } = client([json(body, status, headers)], { token: 'secret' });

    const error = await github.get('/x').catch((caught) => caught);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error.status).toBe(status);
    expect(error.message).toContain(message);
    expect(error.message).not.toContain('secret');
    expect(waits).toEqual([]);
  });

  it('rejects invalid JSON', async () => {
    const { github } = client([new Response('<html>', { status: 200 })]);

    await expect(github.get('/x')).rejects.toThrow('GitHub returned invalid JSON for /x');
  });
});
