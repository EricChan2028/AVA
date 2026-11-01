/** A GitHub repository named by its owner and repository name. */
export interface GitHubRepositoryRef {
  owner: string;
  name: string;
}

/** GitHub logins: up to 39 letters, digits and hyphens, not starting with a hyphen. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
/** Repository names: up to 100 ASCII letters, digits, `.`, `-` and `_`. */
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
/** Repository pages whose links still name the whole repository. */
const REPOSITORY_PAGES = new Set(['issues', 'pulls', 'releases', 'milestones', 'labels']);

function invalid(input: string): Error {
  return new Error(
    `Invalid GitHub repository "${input}". Use owner/name or a link such as https://github.com/owner/name.`
  );
}

function repositoryRef(input: string, owner?: string, name?: string): GitHubRepositoryRef {
  const repository = name?.replace(/\.git$/i, '');
  if (!owner || !repository || !OWNER.test(owner) || !NAME.test(repository) || /^\.+$/.test(repository)) {
    throw invalid(input);
  }
  return { owner, name: repository };
}

/**
 * Parse `owner/name`, a github.com repository link, or a link to one of its
 * issue, pull request, release, milestone or label lists.
 */
export function parseGitHubRepository(input: string): GitHubRepositoryRef {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    const [owner, name, ...rest] = value.split('/');
    if (rest.length > 0) throw invalid(input);
    return repositoryRef(input, owner, name);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(input);
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(
      `GitHub repository links must be on github.com: ${input}. For GitHub Enterprise, set apiUrl and pass owner/name.`
    );
  }
  const [owner, name, page, ...rest] = url.pathname.split('/').filter(Boolean);
  if ((page !== undefined && !REPOSITORY_PAGES.has(page.toLowerCase())) || rest.length > 0) throw invalid(input);
  return repositoryRef(input, owner, name);
}

/** Whether a CLI argument is a github.com link to a repository or one of its lists. */
export function isGitHubRepositoryUrl(input: string): boolean {
  if (!/^https?:\/\//i.test(input)) return false;
  try {
    parseGitHubRepository(input);
    return true;
  } catch {
    return false;
  }
}
