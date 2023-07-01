import assert from "assert";
import { ID, idToSafeName } from "./id";
import { assertRuntime, assertStartupTime, currentPersona, runningInProcess } from "./persona";
import { DockerService, DockerVolume } from "./docker-compose";
import { Password } from "./password";
import { Pool, PoolConfig } from 'pg';
import { Port } from "./port";
import { registerTeardownHandler } from "./teardown";

export interface IndexEntry<T, U> {
  /** Key in the main table */
  key: PrimaryKey;

  /** Key in the index table */
  indexKey: IndexKey;

  /** Value in the main table (if retrieveValues is true) */
  value?: T;

  /** Value in the index table (if retrieveInlineValues is true) */
  inlineValue?: U;
}

interface IndexGetOpts {
  /**
   * True to retrieve the associated values from the main table. Defaults to true.
   */
  retrieveValues?: boolean;

  /**
   * True to retrieve the inline values from the index table. Defaults to true.
   */
  retrieveInlineValues?: boolean;
}

export interface StoreIndex<T, U> {
  /**
   * Retrieves all the items from the store that match the given index key
   */
  get(indexKey: IndexKey, opts?: IndexGetOpts): Promise<IndexEntry<T, U>[]>;
}

type PrimaryKey = string;
type IndexId = string;
type IndexKey = string;

interface IndexerOutputEntry<U> {
  /**
   * The key to put in the index. These do not need to be unique.
   *
   * This is not the primary key of the object being indexed. It's a piece of
   * information you want to use to look up the object.
   *
   * Example: If you're indexing users by their security roles, the `key` might
   * be the security role. Then `StoreIndex.get('admin')` would return all the
   * users with the admin role.
   */
  indexKey: IndexKey;

  /**
   * Optionally, a value to store in the index itself. This is useful if you
   * want to get information from the index without returning the whole object
   * from the main table. For example, if you're indexing users by their
   * security roles, you might want to store the user's name in the index so
   * that `StoreIndex.get('admin')` returns a list of names instead of a list
   * of objects.
   */
  inlineValue?: U;
};

type Indexer<T, U> = (value: T) => IndexerOutputEntry<U>[];

/**
 * A simple key-value store with optional indexes, backed either its private
 * postgres docker instance or an in-memory data model.
 */
export class Store<T = any> {
  private backingStore: InMemoryStore<T> | PostgresStore<T>;

  public Index: { new <U>(id: ID, indexer: Indexer<T, U>): StoreIndex<T, U> }

  constructor (public id: ID) {
    assertStartupTime();

    const backingStore = runningInProcess
      ? new InMemoryStore<T>(id)
      : new PostgresStore<T>(id);
    this.backingStore = backingStore;

    // Defining this as a class to be consistent with the style of the library
    // where resources are created using `new` syntax
    this.Index = class<U> implements StoreIndex<T, U> {
      private backingIndex: StoreIndex<T, U>;

      constructor (id: ID, indexer: Indexer<T, U>) {
        assertStartupTime();
        this.backingIndex = backingStore.defineIndex(id, indexer);
      }

      get(indexKey: IndexKey, opts?: IndexGetOpts): Promise<IndexEntry<T, U>[]> {
        return this.backingIndex.get(indexKey, opts);
      }
    }
  }

  /**
   * Get a JSON value from the store. Returns undefined if the key is not found.
   */
  get(key: PrimaryKey): Promise<T | undefined> {
    assertRuntime();
    return Promise.resolve(this.backingStore.get(key));
  }

  /**
   * Check if a particular key is in the store
   */
  has(key: PrimaryKey): Promise<boolean> {
    assertRuntime();
    return Promise.resolve(this.backingStore.has(key));
  }

  /**
   * Set a JSON value in the store, or pass undefined to delete the value
   */
  set(key: PrimaryKey, value: T | undefined): Promise<void> {
    assertRuntime();
    if (value === undefined) {
      return Promise.resolve(this.backingStore.del(key));
    } else {
      return Promise.resolve(this.backingStore.set(key, value));
    }
  }

  /**
   * Delete an entry in the store. Does nothing if the key is not found.
   */
  async del(key: PrimaryKey): Promise<void> {
    assertRuntime();
    return this.backingStore.del(key);
  }

  /**
   * Atomically modify an item in the store
   */
  async modify(key: PrimaryKey, fn: (value: T | undefined) => T | undefined): Promise<T | undefined> {
    assertRuntime();
    return this.backingStore.modify(key, fn);
  }

  /**
   * Enumerate all keys in the store, in batches. Note that new keys that are
   * added during this process are not guaranteed to be included in the result,
   * and keys deleted during this process are not guaranteed to be excluded. The
   * only guarantee is that all keys that existed at the start of the process,
   * that have not been deleted at any point during the process, will be
   * included in the result.
   */
  allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey[]> {
    assertRuntime();
    return this.backingStore.allKeys(opts);
  }
}

interface IndexInfo<T> {
  id: ID;
  tableName: string;
  indexer: Indexer<T, any>;
}

class PostgresStore<T> {
  private postgresService: DockerService;
  private password: Password;
  private externalPort: Port;
  private primaryTableName: string;
  private volume: DockerVolume;
  // Resolved promise if we're connected. Rejected promise if we couldn't
  // connect. Pending promise if we're busy connecting. Undefined if we haven't
  // tried to connect yet.
  private postgresPool?: Promise<Pool>;
  private indexes: IndexInfo<T>[] = [];

  constructor (public id: ID) {
    assertStartupTime();
    this.password = new Password(id`password`);
    this.externalPort = new Port(id`port`);
    this.volume = new DockerVolume(id`data`);
    this.primaryTableName = idToSafeName(id);

    this.postgresService = new DockerService(id, {
      dockerImage: 'postgres:latest',
      environment: {
        POSTGRES_PASSWORD: this.password
      },
      ports: [{ internal: 5432, external: this.externalPort }],
      volumeMounts: [{
        volume: this.volume,
        mountPath: '/var/lib/postgresql/data'
      }]
    })
  }

  defineIndex<U>(id: ID, indexer: Indexer<T, U>): StoreIndex<T, U> {
    assertStartupTime();
    const tableName = idToSafeName(id);
    const indexInfo: IndexInfo<T> = { id, tableName, indexer };
    this.indexes.push(indexInfo);
    return {
      get: (key, opts) => this.index_get(indexInfo, key, opts)
    }
  }

  async get(key: PrimaryKey): Promise<T | undefined> {
    assertRuntime();
    const pool = await this.getOrCreatePool();
    const result = await pool.query(
      `SELECT value FROM ${this.primaryTableName} WHERE key = $1`, [key]);
    if (result.rows.length === 0) {
      return undefined;
    }
    return result.rows[0].value;
  }

  async has(key: PrimaryKey): Promise<boolean> {
    assertRuntime();
    const pool = await this.getOrCreatePool();
    const result = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM ${this.primaryTableName} WHERE key = $1)`, [key]);
    return result.rows[0].exists;
  }

  async set(key: PrimaryKey, value: T): Promise<void> {
    assertRuntime();
    const pool = await this.getOrCreatePool();

    const params: string[] = [];
    const statements: string[] = [];

    // Define a parameter and return the SQL placeholder for it (e.g. $1)
    const param = (value: any) => '$' + params.push(value);
    // Define a statement and add it to the list of statements to execute
    const statement = (sqlStatement: string) => statements.push(sqlStatement);

    // Start the transaction
    statement('BEGIN;');

    // Insert or update in main table
    const keyParam = param(key);
    const valueParam = param(value);
    statement(`
      INSERT INTO ${this.primaryTableName} (key, value) VALUES (${keyParam}, ${valueParam})
      ON CONFLICT (key) DO UPDATE SET value = ${valueParam} WHERE ${this.primaryTableName}.key = ${keyParam};
    `);

    for (const { tableName, indexer } of this.indexes) {
      // Delete all old entries in index table for given object key
      statement(`DELETE FROM ${tableName} WHERE key = ${keyParam};`);

      // Get all index keys and their corresponding inline values using the indexer function
      for (const { indexKey, inlineValue } of indexer(value)) {
        // Insert new index rows for each index key and inline value
        statement(`INSERT INTO ${tableName} (indexKey, key, inlineValue) VALUES (${param(indexKey)}, ${param(key)}, ${param(inlineValue)});`);
      }
    }

    // End the transaction
    statement(`COMMIT;`);

    // Execute the accumulated query with parameters
    const query = statements.join('\n\n');
    await pool.query(query, params);
  }


  async del(key: PrimaryKey): Promise<void> {
    assertRuntime();
    const pool = await this.getOrCreatePool();
    await pool.query(
      `DELETE FROM ${this.primaryTableName} WHERE key = $1`, [key]);
  }

  async modify(key: PrimaryKey, fn: (value: T | undefined) => T | undefined): Promise<T | undefined> {
    assertRuntime();
    const pool = await this.getOrCreatePool();

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Retrieve the existing value
      const result = await pool.query(
        `SELECT value FROM ${this.primaryTableName} WHERE key = $1 FOR UPDATE`, [key]);
      const existingValue = result.rows.length > 0 ? result.rows[0].value : undefined;

      // Apply the modification function
      const newValue = fn(existingValue);

      if (newValue === undefined) {
        // Delete the record if the new value is undefined
        await pool.query(`DELETE FROM ${this.primaryTableName} WHERE key = $1`, [key]);
      } else {
        // Update the record
        await pool.query(
          `INSERT INTO ${this.primaryTableName} (key, value) VALUES ($1, $2)
          ON CONFLICT (key) DO UPDATE SET value = $2 WHERE ${this.primaryTableName}.key = $1`,
          [key, newValue]
        );
      }

      // Commit the transaction
      await pool.query('COMMIT');
      return newValue;

    } catch (error) {
      // Something went wrong, rollback the transaction
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  async *allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey[]> {
    assertRuntime();
    const pool = await this.getOrCreatePool();
    const batchSize = opts?.batchSize || 100; // default batch size of 100 if not specified

    let lastKey: PrimaryKey | null = null;

    while (true) {
      // Retrieve the keys in batches
      let result;
      if (lastKey === null) {
        result = await pool.query(
          `SELECT key FROM ${this.primaryTableName} ORDER BY key ASC LIMIT $1`,
          [batchSize]
        );
      } else {
        result = await pool.query(
          `SELECT key FROM ${this.primaryTableName} WHERE key > $1 ORDER BY key ASC LIMIT $2`,
          [lastKey, batchSize]
        );
      }

      const keys = result.rows.map(row => row.key) as PrimaryKey[];

      // If no more keys, then exit the loop
      if (keys.length === 0) {
        break;
      }

      // Yield the batch of keys
      yield keys;

      // Remember the last key for the next query
      lastKey = keys[keys.length - 1];
    }
  }

  private getOrCreatePool(): Promise<Pool> {
    assertRuntime();
    if (!this.postgresPool) {
      this.postgresPool = this.createPool();
    }
    return this.postgresPool;
  }

  private async createPool(): Promise<Pool> {
    const startTime = Date.now();
    const maxWaitTime = 10_000;
    const baseDelay = 100; // base delay in milliseconds
    let attempt = 0;

    // The port and hostname are different depending on whether we're running
    // in a CLI on the docker-compose host or inside the docker-compose
    // network.
    const port = currentPersona!.region === 'inside-docker-network'
      ? 5432
      : this.externalPort!.get();
    const host = currentPersona!.region === 'inside-docker-network'
      ? this.postgresService.name
      : 'localhost';
    const user = 'postgres';
    const password = this.password!.get();
    const database = 'postgres'
    const config: PoolConfig = { host, port, user, password, database };
    let pool: Pool | undefined;

    // A retry loop to connect to the database. This is necessary because the
    // database may not be ready yet when the store is created, especially if
    // the store is created in a docker-compose network where we're launching
    // all the services roughly at the same time.
    while (true) {
      try {
        if (pool) pool.end();
        const newPool = new Pool(config);
        pool = newPool;
        await this.seedDatabase(pool);

        registerTeardownHandler(() => newPool.end());
        return pool;
      } catch (err) {
        // Check if total wait time has exceeded 30 seconds
        if (Date.now() - startTime > maxWaitTime) {
          throw err;
        }

        // Exponential backoff with jitter
        const delay = Math.pow(2, attempt + Math.random()) * baseDelay;

        console.log(`Could not connect to the database, retrying in ${Math.round(delay)} ms...`)
        await new Promise(resolve => setTimeout(resolve, delay));

        attempt++;
      }
    }
  }

  private async seedDatabase(postgresPool: Pool): Promise<void> {
    // Start transaction
    await postgresPool.query('BEGIN');

    try {
      // Create the primary table if it doesn't exist.
      await postgresPool.query(`CREATE TABLE IF NOT EXISTS ${this.primaryTableName} (
        key TEXT PRIMARY KEY,
        value jsonb
      )`);

      // Loop through each index and create the index tables.
      for (const index of this.indexes) {
        // Create index table
        await postgresPool.query(`
          CREATE TABLE IF NOT EXISTS ${index.tableName} (
            id SERIAL PRIMARY KEY,
            -- The indexKey column is used to store the index key
            indexKey TEXT,
            -- The key column is used to store the primary key of the item
            key TEXT REFERENCES ${this.primaryTableName}(key),
            inlineValue jsonb
          )
        `);

        // Create index on indexKey column for faster searches
        await postgresPool.query(`
          CREATE INDEX IF NOT EXISTS idx_${index.tableName}_indexKey
          ON ${index.tableName} (indexKey)
        `);

        // Create index on key column for faster deletions
        await postgresPool.query(`
          CREATE INDEX IF NOT EXISTS idx_${index.tableName}_key
          ON ${index.tableName} (key)
        `);
      }

      // Commit transaction
      await postgresPool.query('COMMIT');
    } catch (error) {
      // Rollback transaction in case of any error
      await postgresPool.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Retrieves all the items from the store that match the given index key
   */
  private async index_get(index: IndexInfo<T>, indexKey: IndexKey, opts?: IndexGetOpts): Promise<IndexEntry<T, any>[]> {
    assertRuntime();

    const retrieveValues = opts?.retrieveValues ?? true;
    const retrieveInlineValues = opts?.retrieveInlineValues ?? true;

    // Construct the SQL query based on the options.
    let parameters: any[] = [indexKey];

    let toSelect = ['indexTable.indexKey', 'indexTable.key'];
    if (retrieveInlineValues) toSelect.push('indexTable.inlineValue');
    if (retrieveValues) toSelect.push('mainTable.value');

    let query = `
      SELECT ${toSelect.join(', ')}
      FROM ${index.tableName} AS indexTable`

    if (retrieveValues) {
      query += `
        JOIN ${this.primaryTableName} AS mainTable
        ON indexTable.key = mainTable.key`
    }

    query += `
      WHERE indexTable.indexKey = $1`

    const pool = await this.getOrCreatePool();
    const result = await pool.query(query, parameters);

    // The rows are already in the target format because the column names are consistent with the TypeScript names
    return result.rows;
  }

}

interface IndexRow<T> {
  indexKey: IndexKey;
  key: PrimaryKey;
  value: T;
  inlineValue: any;
};

interface PrimaryRow<T> {
  value: T;
  indexKeys: Map<IndexId, IndexKey[]>;
};

class InMemoryStore<T> {
  private indexes: Map<IndexId, {
    indexer: Indexer<T, any>;
    data: Map<IndexKey, Map<PrimaryKey, IndexRow<T>[]>>;
  }> = new Map();

  private data: Map<PrimaryKey, PrimaryRow<T>> = new Map();

  constructor (public id: ID) {
    assertStartupTime();
  }

  defineIndex<U>(id: ID, indexer: Indexer<T, U>): StoreIndex<T, U> {
    assertStartupTime();

    if (this.indexes.has(id.value)) {
      throw new Error(`Index ${id.value} already defined`);
    }

    const inMemoryIndex = new Map<IndexKey, Map<PrimaryKey, IndexRow<T>[]>>();
    this.indexes.set(id.value, { indexer, data: inMemoryIndex });

    return {
      get: async (indexKey: IndexKey, opts?: IndexGetOpts): Promise<IndexEntry<T, U>[]> => {
        return Array.from(inMemoryIndex.get(indexKey)?.values() ?? []).flat()
      }
    }
  }

  get(key: PrimaryKey): T | undefined {
    assertRuntime();
    const entry = this.data.get(key);
    return entry?.value
  }

  has(key: PrimaryKey): boolean {
    assertRuntime();
    return this.data.has(key)
  }

  set(key: PrimaryKey, value: T): void {
    assertRuntime();

    // Only JSON values are preserved in the store
    value = JSON.parse(JSON.stringify(value));

    // Remove from old indexes
    this.del(key);

    // Insert into new indexes
    const indexKeys = new Map<IndexId, IndexKey[]>();
    for (const [indexId, index] of this.indexes.entries()) {
      const indexEntries = index.indexer(value);
      for (const { indexKey, inlineValue } of indexEntries) {
        let indexData = index.data.get(indexKey);
        if (!indexData) {
          indexData = new Map();
          index.data.set(indexKey, indexData);
        }

        // Rows for object
        let rows = indexData.get(key);
        if (!rows) {
          rows = [];
          indexData.set(key, rows);
        }

        rows.push({ indexKey, value, key, inlineValue });
      }
      // Record in the store that we've added it to the index so we can remove
      // it again later without searching the indexes.
      indexKeys.set(indexId, indexEntries.map(entry => entry.indexKey));
    }

    this.data.set(key, { value, indexKeys });
  }

  del(key: PrimaryKey): void {
    assertRuntime();
    const original = this.data.get(key);

    if (!original) {
      return undefined
    }

    // For each index in which the original object appears
    for (const [indexId, indexKeys] of original.indexKeys.entries()) {
      const index = this.indexes.get(indexId)!;
      // For each key in the index under which the original object appears
      for (const indexKey of indexKeys) {
        const objects = index.data.get(indexKey)!;
        // Remove the original object from the index
        assert(objects.has(key));
        objects.delete(key);
        if (objects.size === 0) {
          index.data.delete(indexKey);
        }
      }
    }

    this.data.delete(key);

    return undefined
  }

  modify(key: PrimaryKey, fn: (value: T | undefined) => T | undefined): T | undefined {
    assertRuntime();
    // The in-memory store is already atomic
    const oldValue = this.get(key);
    const newValue = fn(oldValue);
    if (newValue === undefined) {
      this.del(key);
    } else {
      this.set(key, newValue);
    }
    return newValue;
  }

  // Enumerate all keys in the store, in batches. Note that new keys that are
  // added during this process are not guaranteed to be included in the result,
  // and keys deleted during this process are not guaranteed to be excluded. The
  // only guarantee is that all keys that existed at the start of the process,
  // that have not been deleted at any point during the process, will be
  // included in the result.
  async *allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey[]> {
    const batchSize = opts?.batchSize ?? 100;
    const keys = Array.from(this.data.keys());
    for (let i = 0; i < keys.length; i += batchSize) {
      yield keys.slice(i, i + batchSize);
    }
  }
}