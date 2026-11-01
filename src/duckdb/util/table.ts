/**
 * Materialize JavaScript rows as typed in-memory DuckDB tables with declared
 * keys, so schema discovery reports primary keys and relationships for
 * sources that are not databases (for example SaaS APIs).
 */

import { sqlIdentifier, sqlStringLiteral } from '../../util/sql';

import { removeTempFile, writeTempFile } from './file';

import type { DuckDBConnection } from '../../types';

export interface TableColumn {
  name: string;
  /** DuckDB type, such as VARCHAR, BIGINT, TIMESTAMP or VARCHAR[]. */
  type: string;
  notNull?: boolean;
  /**
   * Values of a categorical text column. The column becomes an ENUM of these
   * and every other value found in the rows, so the schema lists its values.
   */
  values?: readonly string[];
}

export interface TableForeignKey {
  columns: string[];
  /** Referenced table; it must be created first and its columns must be its primary or a unique key. */
  table: string;
  referencedColumns: string[];
}

export interface TableDefinition {
  name: string;
  columns: TableColumn[];
  primaryKey?: string[];
  foreignKeys?: TableForeignKey[];
}

const identifiers = (names: string[]) => names.map(sqlIdentifier).join(', ');

/** The column's DuckDB type for these rows; a categorical column without any value stays VARCHAR. */
export function columnType(column: TableColumn, rows: Record<string, unknown>[]): string {
  if (!column.values) return column.type;
  const values = new Set(column.values);
  for (const row of rows) {
    const value = row[column.name];
    if (typeof value === 'string') values.add(value);
  }
  return values.size === 0 ? 'VARCHAR' : `ENUM(${[...values].sort().map(sqlStringLiteral).join(', ')})`;
}

export function createTableSQL(
  { name, columns, primaryKey, foreignKeys = [] }: TableDefinition,
  rows: Record<string, unknown>[] = []
): string {
  const parts = columns.map(
    (column) => `${sqlIdentifier(column.name)} ${columnType(column, rows)}${column.notNull ? ' NOT NULL' : ''}`
  );
  if (primaryKey?.length) parts.push(`PRIMARY KEY (${identifiers(primaryKey)})`);
  for (const key of foreignKeys) {
    parts.push(
      `FOREIGN KEY (${identifiers(key.columns)}) REFERENCES ${sqlIdentifier(key.table)} (${identifiers(
        key.referencedColumns
      )})`
    );
  }
  return `CREATE TABLE ${sqlIdentifier(name)} (${parts.join(', ')})`;
}

/**
 * Create a table and insert rows whose values already match the declared
 * types (timestamps as ISO 8601 strings, lists as arrays). Rows pass through a
 * temporary newline-delimited JSON file read with the declared column types,
 * which is deleted before returning.
 */
export async function createTable(
  conn: DuckDBConnection,
  table: TableDefinition,
  rows: Record<string, unknown>[]
): Promise<void> {
  await conn.run(createTableSQL(table, rows));
  if (rows.length === 0) return;

  const file = await writeTempFile(rows.map((row) => JSON.stringify(row)).join('\n'), 'json');
  try {
    // Categorical columns are read as text and cast to their ENUM on insert.
    const columns = table.columns
      .map((column) => `${sqlStringLiteral(column.name)}: ${sqlStringLiteral(column.values ? 'VARCHAR' : column.type)}`)
      .join(', ');
    await conn.run(
      `INSERT INTO ${sqlIdentifier(table.name)} SELECT * FROM read_json(${sqlStringLiteral(
        file
      )}, format = 'newline_delimited', columns = {${columns}})`
    );
  } finally {
    await removeTempFile(file);
  }
}
