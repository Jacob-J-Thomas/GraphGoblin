import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Schema } from './schema.js';

export type Database = LibSQLDatabase<Schema>;
export type SqliteTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
