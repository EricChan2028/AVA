/**
 * AVA v4 - Node.js entry point
 * Registers all engines before exporting AVA.
 */

import { DuckDBEngine } from './duckdb';
import { JavaScriptEngine, PythonEngine } from './interpreter';
import { BigQueryEngine, ClickHouseEngine, SupabaseEngine } from './remote';
import { registerEngine } from './engines';

registerEngine('duckdb', DuckDBEngine);
registerEngine('clickhouse', ClickHouseEngine);
registerEngine('supabase', SupabaseEngine);
registerEngine('bigquery', BigQueryEngine);
registerEngine('javascript', JavaScriptEngine);
registerEngine('python', PythonEngine);

export { AVA } from './ava';
export { registerEngine } from './engines';
export type { EngineClass } from './engines';
export { executionResult } from './util/result';

export type { JavaScriptEngine } from './interpreter';
export type {
  DataModel,
  Semantic,
  Model,
  Column,
  Relationship,
  JoinType,
  View,
  Cube,
  Measure,
  CubeDimension,
  TimeDimension,
  TableReference,
  PrimaryKey,
  Properties,
  JsonValue,
  Schema,
  Profile,
  LLMConfig,
  AVAConfig,
  AnalysisConfig,
  EngineConfig,
  DuckDBEngineOptions,
  PythonEngineOptions,
  DataSourceConfig,
  SchemaOptions,
  SemanticOptions,
  JSONReadOptions,
  ClickHouseSourceOptions,
  BigQuerySourceOptions,
  BigQueryCredentials,
  AnalysisEngine,
  ExecutionOptions,
  ExecutionResult,
  QueryColumn,
  QueryLanguage,
  QueryDialect,
  AnalysisResponse,
  AnalysisStrategy,
  AnalysisStrategyConfig,
  AnalysisRuntime,
  VisualizeResponse,
  ChartConfig,
  ChartSpec,
  SuggestResult,
  ChartType,
  ProfileOptions,
  ParsedProfileOptions,
  Metric,
  MetricId,
  MetricConfig,
  LogicalType,
} from './types';
