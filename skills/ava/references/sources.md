# Data Sources

## Choose an Engine

| Data source | Engine | Query language |
| --- | --- | --- |
| CSV/JSON/Parquet/Excel files, inline CSV/JSON | DuckDB by default; Python is optional | DuckDB SQL / Python (pandas) |
| MySQL, PostgreSQL, SQLite, MongoDB | DuckDB by default | DuckDB SQL |
| ClickHouse | ClickHouse is selected automatically | ClickHouse SQL |
| Supabase | Supabase is selected automatically | PostgreSQL SQL |
| Feishu Bitable | DuckDB only | DuckDB SQL |
| GitHub repositories | DuckDB only | DuckDB SQL |
| Inline CSV/JSON/text | JavaScript is optional when explicitly selected | JavaScript |

To use Python or JavaScript, add `--engine python` or `--engine javascript` to the `source` command. Python does not connect directly to databases. To post-process database results with pandas, query the database first, then export the complete result as described in [Results and Post-Processing](queries.md#results-and-post-processing).

## Files and Configuration

**Load a regular file or URL directly:**

```sh
ava source /data/sales.csv > session.json
```

The CLI identifies CSV, JSON, Parquet, XLSX, and SQLite (`.sqlite`, `.sqlite3`, `.db`) files by extension. If the extension is not recognized, use `--type` with `csv-file`, `json-file`, `parquet`, `excel`, or `sqlite`. SQLite supports local files only; other file sources support HTTP(S). Each Excel sheet becomes a table; use the schema to find its actual table name.

**Use configuration for inline data, authentication, or custom read options:**

Configuration includes `type` and `options`. `type` specifies the data format or database type, not the engine. For example, to read a semicolon-delimited CSV while preserving text types, save the following as `source.json`:

```json
{
  "type": "csv-file",
  "options": {
    "path": "/data/sales.csv",
    "options": { "delim": ";", "all_varchar": true }
  }
}
```

```sh
ava source @source.json > session.json
```

A regular `.json` file is read as data rows. Only `@file` or stdin `-` reads JSON as configuration; configuration input cannot be combined with `--type`. Relative paths are resolved from the command's working directory. Read options may vary by engine.

For other common configurations, set `type` and `options` as shown:

| Use case | `type` | Example `options` |
| --- | --- | --- |
| JSON rows | `json` | `{"data":[{"region":"East","sales":10}]}` |
| Inline CSV | `csv` | `{"csv":"region,sales\nEast,10"}` |
| Authenticated URL | `json-file` | `{"path":"https://example.com/data.json","headers":{"Authorization":"******"}}` |

For unstructured text, you can first extract JSON rows containing only information supported by the source text. The native `text` source calls an internal AVA model and requires additional model configuration.

## Databases

Use the configuration format and load command shown above:

| `type` | Example `options` |
| --- | --- |
| `mysql` | `{"host":"localhost","database":"sales","user":"reader","password":"REPLACE"}` |
| `postgresql` | `{"host":"localhost","database":"sales","user":"reader","password":"REPLACE","schema":"public"}` |
| `mongodb` | `{"connection":"mongodb://localhost:27017","database":"sales"}` |
| `clickhouse` | `{"url":"http://localhost:8123","database":"sales","username":"reader","password":"REPLACE"}` |
| `supabase` | `{"accessToken":"REPLACE","projectRef":"REPLACE"}` |

Use authorized read-only credentials. Restrict temporary credential files to the current user and delete them after loading. Do not put credentials in deliverables or logs.

- MySQL, PostgreSQL, SQLite, and MongoDB require the corresponding DuckDB extensions. MongoDB uses the `mongo` community extension. Each collection becomes a table, and its schema is inferred from samples, so rare fields may be missed.
- ClickHouse connects over HTTP(S) and requires version 23.10 or later.
- Supabase uses the Management API; `accessToken` must be a token authorized for that API.

## Feishu Bitable

`feishu-bitable` is read-only and uses DuckDB; the Python and JavaScript engines cannot load it. Rows are exposed as one view named `data`. The `view` parameter in the URL is ignored and the whole table is loaded, not one view.

The CLI detects Bitable links automatically (Node.js 22.13+), including tables that live inside a wiki:

```sh
ava source "https://<tenant>.feishu.cn/base/<app_token>?table=<table_id>" > session.json
ava source "https://<tenant>.feishu.cn/wiki/<node_token>?table=<table_id>" > session.json
```

A `/wiki/` URL carries a node token, so AVA calls the wiki `get_node` API and uses the hosted object's `obj_token` as the Bitable app token. The node must host a Bitable (`obj_type=bitable`); the app also needs `wiki:wiki:readonly` and membership of the wiki space, which is separate from the document grant on the table. Docx and Sheets nodes are rejected with an explicit error.

When `?table=` is missing, AVA uses the only table of the Bitable and, when there are several, stops with the table list so you can pick one. For non-URL configs, pass `feishu-bitable` through an `@file` or stdin config; `--type` cannot supply it.

`appId` and `appSecret` are required. They are the internal app credentials used to request a tenant access token, and the app must be added as a collaborator on the table. A `bitable:app:readonly` scope is enough unless the table enables advanced permissions, which require manage rights. Credentials are resolved from the source config first, then `AVA_FEISHU_APP_ID` / `AVA_FEISHU_APP_SECRET`, then `~/.ava/feishu.json`. In a terminal, AVA prompts for the pair, verifies it, and saves it to `~/.ava/feishu.json`.

The app must belong to an account allowed to call the Open Platform. Apps created by signing in to `open.feishu.cn` with a personal account such as a Doubao account are rejected with `Feishu Error 21001` (access denied due to platform policy) when requesting the tenant access token; create the app with a Feishu account bound to a phone number instead.


```json
{
  "type": "feishu-bitable",
  "options": {
    "url": "https://<tenant>.feishu.cn/base/<app_token>?table=<table_id>",
    "appId": "<app-id>",
    "appSecret": "<app-secret>"
  }
}
```

```sh
ava source @feishu.json > session.json
```

Provide `url`, or both `appToken` and `tableId`; when both are set they must name the same table. The path segment after `base` is `appToken`, and the `table` query parameter is `tableId`. For a `/wiki/` URL the segment after `wiki` is a node token that AVA resolves to the app token, so `appToken` alone is not enough to describe a wiki table. Never commit `appSecret` or put it in deliverables, logs, or screenshots; rotate it if it leaks.

Supported field types become columns. Other types are omitted. Complex cells are flattened to text; list values are joined with a comma.

| type | Field | Cell value |
| --- | --- | --- |
|1| Text | string, or null when empty |
|2| Number | number, or null when empty |
|3| Single select | option name, or null |
|4| Multi select | option names joined by comma, or null |
|5| Date | ISO string, or null |
|7| Checkbox | boolean |
|11| User | names joined by comma (name → en_name → email → id) |
|13| Phone | string, or null |
|15| URL | link text, or the URL, or null |
|17| Attachment | file names joined by comma |
|18| Single link | record IDs joined by comma |
|19| Lookup | converted from the wrapped result type |
|20| Formula | converted from the wrapped result type |
|21| Duplex link | record IDs joined by comma |
|22| Location | full address, falling back to name, address, or coordinates |
|23| Group chat | group names joined by comma |
|1001| Created time | ISO string |
|1002| Last modified time | ISO string |
|1003| Created user | names joined by comma |
|1004| Modified user | names joined by comma |
|1005| Auto number | string, or null |

Stage (24) and button (3001) fields are read-only and skipped. A formula or
lookup whose result type is unsupported becomes null.

## GitHub

`github` reads repositories through the GitHub REST API (read-only) into DuckDB tables; the Python and JavaScript engines cannot load it. The CLI detects github.com repository links, including their `/issues`, `/pulls`, `/releases`, `/milestones` and `/labels` pages:

```sh
ava source https://github.com/antvis/AVA > session.json
ava source antvis/AVA --type github > session.json
```

Links to a single issue, a file, or a branch are rejected. The token comes from the config, then `AVA_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` (for example `GH_TOKEN=$(gh auth token)`). Public repositories load without a token, but unauthenticated requests share 60 requests per hour per IP address; a token raises the limit to 5,000 and reads the private repositories it can access. Use a fine-grained token with read-only access, and never put it in deliverables or logs.

Use a config to select resources, limit the period, or compare repositories:

```json
{
  "type": "github",
  "options": {
    "repository": ["antvis/AVA", "antvis/G2"],
    "resources": ["issues", "pull_requests", "comments"],
    "since": "2026-01-01"
  }
}
```

| Option | Meaning |
| --- | --- |
| `repository` | `owner/name` or github.com link; an array loads several repositories into the same tables. |
| `resources` | Default `issues`, `pull_requests`, `labels`, `milestones`, `releases`; add `comments` for response times. `repositories` is always loaded. |
| `since` | ISO date or timestamp (UTC without an offset). Keeps issues, pull requests and comments updated on or after it; open items not updated since then are left out, so omit it to count the current backlog. |
| `maxRecords` | Default 10,000 per repository and list. Larger lists fail with an error instead of loading partially; set `since` or raise it. |
| `apiUrl` | GitHub Enterprise Server API root, such as `https://github.example.com/api/v3`, with `repository` as `owner/name`. |
| `maxRateLimitWaitMs` | Default 60,000. Longer rate-limit waits fail with the reset time. CLI loading must finish within two minutes. |

Tables, all with a `repository` column (`owner/name`) referencing `repositories.full_name`:

| Table | Key | Notes |
| --- | --- | --- |
| `repositories` | `full_name` | `stars`, `watchers`, `forks`, `open_issues_and_pull_requests` (GitHub counts both), `topics`, `license`, dates. |
| `issues` | `repository`, `number` | Issues only. `state` is `open`/`closed`; `state_reason` is `completed`, `not_planned`, `duplicate` or `reopened`; `author_is_bot`, `author_association`, `assignees`, `labels`, `milestone` (title), `comments`, `reactions`, `created_at`, `closed_at`, `closed_by`. |
| `pull_requests` | `repository`, `number` | `state` is `open`/`closed` and merged pull requests are `closed`, as on GitHub: use `is_merged` (or `merged_at`) for merged and `state = 'closed' AND NOT is_merged` for closed without merging. Also `is_draft` and the issue fields except `state_reason` and `issue_type`. |
| `labels` | `repository`, `name` | `description`, `color`, `is_default`. |
| `milestones` | `repository`, `number` | `title`, `state`, `open_issues`, `closed_issues` (include pull requests), `due_on`. |
| `releases` | `id` | `tag_name`, `is_prerelease`, `published_at`, `assets`, total `downloads`. |
| `comments` | `id` | Only when selected. Conversation comments; join on `repository` and `number` to `issues` or `pull_requests` (`is_pull_request` tells which). |

Query notes: categorical columns are `ENUM`s, so `ava schema` lists their values; timestamps are UTC `TIMESTAMP`s, matching GitHub search qualifiers; compute durations with `date_diff('hour', created_at, merged_at)`. `labels`, `assignees` and `topics` are `VARCHAR[]`: use `list_contains(labels, 'bug')` or `unnest(labels)`. Exclude bots with `NOT author_is_bot`. Bodies, code review comments, reviews and commits are not loaded, and star history is not loaded because GitHub lists stargazers only to tokens with administrator access to the repository.
