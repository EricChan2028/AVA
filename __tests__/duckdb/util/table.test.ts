/**
 * Typed in-memory tables built from JavaScript rows.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, describe, expect, it } from 'vitest';

import { getDuckDBSchema } from '../../../src/duckdb/util/schema';
import { columnType, createTable, createTableSQL } from '../../../src/duckdb/util/table';

import type { DuckDBConnection } from '@duckdb/node-api';
import type { TableDefinition } from '../../../src/duckdb/util/table';

const teams: TableDefinition = {
  name: 'teams',
  columns: [
    { name: 'name', type: 'VARCHAR', notNull: true },
    { name: 'tier', type: 'VARCHAR', values: ['gold', 'silver'] },
  ],
  primaryKey: ['name'],
};

const members: TableDefinition = {
  name: 'team members',
  columns: [
    { name: 'team', type: 'VARCHAR', notNull: true },
    { name: 'login', type: 'VARCHAR', notNull: true },
    { name: 'joined_at', type: 'TIMESTAMP' },
    { name: 'skills', type: 'VARCHAR[]' },
  ],
  primaryKey: ['team', 'login'],
  foreignKeys: [{ columns: ['team'], table: 'teams', referencedColumns: ['name'] }],
};

let connection: DuckDBConnection | undefined;

afterEach(() => {
  connection?.closeSync();
  connection = undefined;
});

async function connect(): Promise<DuckDBConnection> {
  connection = await (await DuckDBInstance.create(':memory:')).connect();
  return connection;
}

describe('util/table', () => {
  it('declares columns, keys and quoted identifiers', () => {
    expect(createTableSQL(members)).toBe(
      'CREATE TABLE "team members" ("team" VARCHAR NOT NULL, "login" VARCHAR NOT NULL, "joined_at" TIMESTAMP, ' +
        '"skills" VARCHAR[], PRIMARY KEY ("team", "login"), FOREIGN KEY ("team") REFERENCES "teams" ("name"))'
    );
  });

  it('builds ENUM types from documented and observed values', () => {
    const tier = teams.columns[1];
    expect(columnType(tier, [])).toBe("ENUM('gold', 'silver')");
    expect(columnType(tier, [{ tier: 'bronze' }, { tier: null }, { tier: "o'neil" }])).toBe(
      "ENUM('bronze', 'gold', 'o''neil', 'silver')"
    );
    expect(columnType({ name: 'kind', type: 'VARCHAR', values: [] }, [{ kind: null }])).toBe('VARCHAR');
  });

  it('loads typed rows that schema discovery reports with keys and relationships', async () => {
    const conn = await connect();
    await createTable(conn, teams, [
      { name: 'charts', tier: 'gold' },
      { name: 'maps', tier: 'bronze' },
    ]);
    await createTable(conn, members, [
      { team: 'charts', login: 'alice', joined_at: '2026-09-01 08:00:00', skills: ['g2', 'ava'] },
      { team: 'maps', login: 'bob', joined_at: null, skills: [] },
    ]);
    await createTable(conn, { ...members, name: 'empty', foreignKeys: [] }, []);

    const rows = (
      await conn.runAndReadAll(
        `SELECT m.login, t.tier::VARCHAR AS tier, strftime(m.joined_at, '%Y-%m-%d %H:%M') AS joined, m.skills
         FROM "team members" m JOIN teams t ON t.name = m.team ORDER BY m.login`
      )
    ).getRowObjectsJson();
    expect(rows).toEqual([
      { login: 'alice', tier: 'gold', joined: '2026-09-01 08:00', skills: ['g2', 'ava'] },
      { login: 'bob', tier: 'bronze', joined: null, skills: [] },
    ]);

    const schema = await getDuckDBSchema(conn, ['teams', 'team members', 'empty']);
    expect(schema.models.map((model) => [model.name, model.primaryKey])).toEqual([
      ['empty', ['team', 'login']],
      ['team members', ['team', 'login']],
      ['teams', 'name'],
    ]);
    expect(schema.models.find((model) => model.name === 'teams')!.columns[1]).toEqual({
      name: 'tier',
      type: "ENUM('bronze', 'gold', 'silver')",
      notNull: false,
    });
    expect(schema.relationships).toEqual([
      expect.objectContaining({
        models: ['team members', 'teams'],
        joinType: 'MANY_TO_ONE',
        condition: '"team members"."team" = "teams"."name"',
      }),
    ]);
  });

  it('rejects rows that break a declared key', async () => {
    const conn = await connect();
    await createTable(conn, teams, [{ name: 'charts', tier: 'gold' }]);

    await expect(createTable(conn, members, [{ team: 'missing', login: 'alice' }])).rejects.toThrow(/foreign key/i);
  });
});
