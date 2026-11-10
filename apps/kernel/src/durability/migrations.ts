import { userTables, type SqlExec } from "#/sqlite-reset";

/** One migration this Durable Object has accepted locally. */
export interface SchemaMigrationRecord {
  id: number;
  name: string;
  checksum: string;
  appliedAt: string;
}

export interface DurableMigration {
  id: number;
  name: string;
  checksum: string;
  apply(): void;
}

export type SynchronousTransaction = <T>(body: () => T) => T;

interface MigrationPlan {
  owner: string;
  sql: SqlExec;
  transaction: SynchronousTransaction;
  baselineVersion: number;
  targetVersion: number;
  migrations: DurableMigration[];
  createBaseline(): void;
  ready?(fresh: boolean): void;
}

/**
 * Bring one Durable Object from its named production baseline to the current
 * schema. Every accepted change and its ledger row commit together. Anything
 * other than a fresh database, the baseline, or the checked current schema is
 * refused without changing application tables.
 */
export function migrateDurableSchema(plan: MigrationPlan): void {
  plan.transaction(() => {
    const fresh = userTables(plan.sql).length === 0;
    if (fresh) {
      plan.createBaseline();
      writeVersion(plan.sql, plan.baselineVersion);
    }

    const current = readVersion(plan.sql, plan.owner);
    if (current < plan.baselineVersion) throw new Error(`${plan.owner} schema ${current} is older than supported baseline ${plan.baselineVersion}`);
    if (current > plan.targetVersion) throw new Error(`${plan.owner} schema ${current} is newer than supported version ${plan.targetVersion}`);

    const migrations = [...plan.migrations].sort((left, right) => left.id - right.id);
    validatePlan(plan, migrations);
    const hasLedger = tableExists(plan.sql, "schema_migrations");
    if (current > plan.baselineVersion && !hasLedger) throw new Error(`${plan.owner} schema ${current} has no migration ledger`);
    if (!hasLedger) createLedger(plan.sql);

    const applied = readLedger(plan.sql);
    validateLedger(plan, migrations, current, applied);
    for (const migration of migrations) {
      if (migration.id <= current) continue;
      migration.apply();
      plan.sql.exec(
        `INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
        migration.id,
        migration.name,
        migration.checksum,
        new Date().toISOString(),
      );
      writeVersion(plan.sql, migration.id);
    }
    plan.ready?.(fresh);
  });
}

function validatePlan(plan: MigrationPlan, migrations: DurableMigration[]): void {
  let expected = plan.baselineVersion + 1;
  for (const migration of migrations) {
    if (migration.id !== expected) throw new Error(`${plan.owner} migration plan skips schema version ${expected}`);
    expected += 1;
  }
  if (expected - 1 !== plan.targetVersion) throw new Error(`${plan.owner} migration plan ends at ${expected - 1}, not ${plan.targetVersion}`);
}

function validateLedger(plan: MigrationPlan, migrations: DurableMigration[], current: number, applied: SchemaMigrationRecord[]): void {
  const known = new Map(migrations.map((migration) => [migration.id, migration]));
  const seen = new Set<number>();
  for (const record of applied) {
    const migration = known.get(record.id);
    if (!migration) throw new Error(`${plan.owner} migration ledger contains unknown migration ${record.id}`);
    if (record.id > current) throw new Error(`${plan.owner} migration ${record.id} is recorded ahead of schema ${current}`);
    if (record.name !== migration.name) throw new Error(`${plan.owner} migration ${record.id} name mismatch`);
    if (record.checksum !== migration.checksum) throw new Error(`${plan.owner} migration ${record.id} checksum mismatch`);
    seen.add(record.id);
  }
  for (const migration of migrations) {
    if (migration.id <= current && !seen.has(migration.id)) throw new Error(`${plan.owner} schema ${current} is missing migration ${migration.id}`);
  }
}

function createLedger(sql: SqlExec): void {
  sql.exec(`CREATE TABLE schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
}

function readLedger(sql: SqlExec): SchemaMigrationRecord[] {
  return sql
    .exec<{ id: number; name: string; checksum: string; applied_at: string }>(`SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id`)
    .toArray()
    .map((row) => ({ id: row.id, name: row.name, checksum: row.checksum, appliedAt: row.applied_at }));
}

function readVersion(sql: SqlExec, owner: string): number {
  if (!tableExists(sql, "meta")) throw new Error(`${owner} database has tables but no schema version`);
  const raw = sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0]?.value;
  const version = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(version) || String(version) !== raw) throw new Error(`${owner} has an invalid schema version`);
  return version;
}

function writeVersion(sql: SqlExec, version: number): void {
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(version));
}

function tableExists(sql: SqlExec, name: string): boolean {
  return sql.exec<{ found: number }>(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`, name).toArray().length > 0;
}
