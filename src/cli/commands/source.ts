import { extname, resolve } from 'path';

import { createSession } from '../session/client';
import { engineTypeSchema, sourceConfig } from '../session/protocol';
import { isFeishuBitableUrl,isFeishuHostUrl,feishuCredentials } from '../feishu';
import { githubToken, isGitHubHostUrl, isGitHubRepositoryUrl } from '../github';
import { llmConfig } from '../config';
import { readJSON } from '../io';
import { option } from '../options';
import { accent, badge, muted } from '../util';

import type { Options } from '../options';

const sourceTypes: Record<string, string> = {
  '.csv': 'csv-file',
  '.json': 'json-file',
  '.parquet': 'parquet',
  '.xlsx': 'excel',
  '.sqlite': 'sqlite',
  '.sqlite3': 'sqlite',
  '.db': 'sqlite',
};

export const description = 'Load a source and return a dataset ID';

export const definition = {
  positionals: 1,
  options: {
    type: { type: 'string', short: 't' },
    engine: { type: 'string' },
  },
} as const;

export async function run([dataset]: string[], options: Options): Promise<{ datasetId: string }> {
  const engine = engineTypeSchema.optional().parse(option(options, 'engine'));
  let input: unknown;

  if (dataset.startsWith('@') || dataset === '-') {
    if (options.type !== undefined) throw new Error('--type cannot be combined with a source config.');
    input = await readJSON(dataset);
  }else if (isFeishuBitableUrl(dataset)){
    if(options.type!== undefined) throw new Error('--type cannot be combined with a feishu-bitable source.');
    input = { type: 'feishu-bitable', options: { url: dataset }} ;
  }else if(isFeishuHostUrl(dataset)){
    throw new Error('Only Feishu Bitable links are supported: /base/<appToken>?table=<tableId> or /wiki/<nodeToken>?table=<tableId>. Docx, Sheets, and other Feishu links cannot be loaded.');}
  else if (isGitHubRepositoryUrl(dataset)) {
    if (options.type !== undefined) throw new Error('--type cannot be combined with a GitHub repository link.');
    input = { type: 'github', options: { repository: dataset } };
  } else if (isGitHubHostUrl(dataset)) {
    throw new Error(
      'Only GitHub repository links are supported, such as https://github.com/<owner>/<repo> or its /issues, /pulls, /releases, /milestones or /labels page.'
    );
  } else {
    const pathname = /^https?:\/\//i.test(dataset) ? new URL(dataset).pathname : dataset;
    const type = option(options, 'type') ?? sourceTypes[extname(pathname).toLowerCase()];
    if (!type) throw new Error('Cannot infer the source type. Pass --type.');
    input = type === 'github' ? { type, options: { repository: dataset } } : { type, options: { path: dataset } };
  }

  const config = sourceConfig.parse(input);

  if ('path' in config.options && !/^https?:\/\//i.test(config.options.path)) {
    config.options.path = resolve(config.options.path);
  }

  if(config.type === 'feishu-bitable'){
    const creds = await feishuCredentials(config.options);
    config.options.appId = creds.appId;
    config.options.appSecret = creds.appSecret;
  }

  if (config.type === 'github' && config.options.token === undefined) {
    const token = githubToken();
    if (token) config.options.token = token;
  }

  return createSession(config, llmConfig(config.type === 'text'), engine);
}

/**
 * Guide terminal users through the next steps with their newly loaded dataset.
 */
export function formatResult({ datasetId }: { datasetId: string }): string {
  return `${accent('✦')} ${badge('AVA')} Ready to explore · ${accent(datasetId)}

${muted('View schema:')} ${accent(`ava schema ${datasetId}`)} ${muted('· More commands:')} ${accent('ava --help')}`;
}

export const help = `${description}.

Usage:
  ava source <dataset> [options]

Arguments:
  dataset           File/URL, @file containing a source config, or - for stdin.
                    Config format: { "type": "json", "options": { "data": [] } }
                    Relative paths resolve from the current working directory.

Options:
  -t, --type <type>  Override the type inferred from the file extension.
                    Types: csv-file, json-file, parquet, excel, sqlite, github.
                    With github, dataset is owner/name.
                    Cannot be used with @file, stdin configs, Feishu or GitHub URLs.
  --engine <type>    duckdb, python, javascript, supabase, or clickhouse.
                    Default: supabase/clickhouse for those sources, otherwise duckdb.
                    Fixed for the session; source support depends on the engine.
                    feishu-bitable uses duckdb. The loaded view is named data.
                    github uses duckdb and loads one table per resource.
  -h, --help         Show help.

Feishu Bitable:
  A /base/ or /wiki/ link from feishu.cn or larksuite.com is detected automatically:
    ava source "https://my.feishu.cn/base/<appToken>?table=<tableId>"
    ava source "https://my.feishu.cn/wiki/<nodeToken>?table=<tableId>"
  A wiki node is resolved to the Bitable it hosts, so the app also needs wiki
  read access and membership of the wiki space.
  Without ?table=, AVA uses the only table of the Bitable and lists the tables
  when there are several. Or pass a "feishu-bitable" config via @file or stdin.
  appId and appSecret are required. They are resolved from the config first,
  then AVA_FEISHU_APP_ID / AVA_FEISHU_APP_SECRET, then ~/.ava/feishu.json;
  in a terminal AVA offers to bind and save them.
  The whole table is loaded as one view named data; the view query is ignored.
  Docx and Sheets links are not supported.

GitHub:
  A github.com repository link, or its /issues, /pulls, /releases, /milestones
  or /labels page, is detected automatically; owner/name works with --type github:
    ava source https://github.com/<owner>/<repo>
    ava source <owner>/<repo> --type github
  Loads the tables repositories, issues, pull_requests, labels, milestones and
  releases through the GitHub REST API (read-only). Use a "github" config via
  @file or stdin to add comments, select resources, set since, or load several
  repositories. The token is read from the config, then AVA_GITHUB_TOKEN,
  GH_TOKEN, GITHUB_TOKEN. Public repositories work without one (60 requests per
  hour per IP address); a token raises the limit to 5,000 and reads private
  repositories it can access.

Environment:
  OPENAI_API_KEY     Required for text sources and subsequent AI commands.
  OPENAI_MODEL       Model name (default: gpt-4o-mini).
  OPENAI_BASE_URL    Optional API base URL.
  AVA_FEISHU_APP_ID      Feishu app credentials for feishu-bitable sources.
  AVA_FEISHU_APP_SECRET
  AVA_GITHUB_TOKEN   GitHub token for github sources; GH_TOKEN and GITHUB_TOKEN also work.
  Model settings are fixed when the dataset is loaded.

In a terminal, shows the dataset ID and suggested next commands.
When piped or redirected, returns JSON containing datasetId.
IDs use a sanitized source name plus a random suffix.
Requires Node.js 22.13+ on macOS or Linux.
Sessions expire after 30 idle minutes; dispose releases them immediately.
Python requires python3 and pandas; local Python execution is not sandboxed.
JavaScript accepts inline csv/json/text configs. Use ava schema to inspect the query language.

Examples:
  ava source sales.csv
  ava source sales.csv --engine python
  ava source @source.json
  echo '{ "type": "json", "options": { "data": [{ "sales": 10 }] } }' | ava source -
  ava source "https://my.feishu.cn/base/<appToken>?table=<tableId>"
  ava source "https://my.feishu.cn/wiki/<nodeToken>?table=<tableId>"
  ava source @feishu.json
  ava source https://github.com/antvis/AVA
  ava source @github.json

feishu.json:
{
  "type": "feishu-bitable",
  "options": {
    "url": "https://my.feishu.cn/base/<appToken>?table=<tableId>",
    "appId": "<app-id>",
    "appSecret": "<app-secret>"
  }
}
    Provide url or both appToken and tableId; they must name the same table.
    Keep appSecret out of version control and logs.

github.json:
{
  "type": "github",
  "options": {
    "repository": ["antvis/AVA", "antvis/G2"],
    "resources": ["issues", "pull_requests", "comments"],
    "since": "2026-01-01"
  }
}
    since keeps issues, pull requests and comments updated on or after it (UTC).
    Keep tokens out of version control and logs.
`;
