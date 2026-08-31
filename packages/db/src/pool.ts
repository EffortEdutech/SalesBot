import pg from 'pg';
const { Pool } = pg;
export type DbPool = InstanceType<typeof Pool>;
export function createPool(databaseUrl: string): DbPool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}
export async function isDatabaseReady(pool: DbPool): Promise<boolean> {
  try {
    await pool.query('select 1 as ready');
    return true;
  } catch {
    return false;
  }
}
