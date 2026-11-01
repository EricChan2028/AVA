import { isGitHubRepositoryUrl } from '../duckdb/loaders/github/repository';

export { isGitHubRepositoryUrl };

/** Environment variables read for a GitHub token, in order. GH_TOKEN and GITHUB_TOKEN match the GitHub CLI. */
export const GITHUB_TOKEN_VARIABLES = ['AVA_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

export function githubToken(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const name of GITHUB_TOKEN_VARIABLES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Whether a CLI argument is any github.com link, so non-repository links can be rejected clearly. */
export function isGitHubHostUrl(dataset: string): boolean {
  if (!/^https?:\/\//i.test(dataset)) return false;
  try {
    return ['github.com', 'www.github.com'].includes(new URL(dataset).hostname.toLowerCase());
  } catch {
    return false;
  }
}
