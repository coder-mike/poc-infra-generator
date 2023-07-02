import assert from "assert";
import { ID, idToSafeName } from "./id";
import { assertRuntime, assertStartupTime, currentPersona, runningInProcess } from "./persona";
import { DockerService, DockerVolume } from "./docker-compose";
import { Password } from "./password";
import pgPromise, { IDatabase, QueryParam }  from 'pg-promise';
import { Port } from "./port";
import { registerTeardownHandler } from "./teardown";
import { registerTestFunction } from "./test";

export interface IndexEntry<T, U> {
  /** Key in the main table */
  key: PrimaryKey;

  /** Value in the main table (if retrieveValues is true) */
  value?: T;

  /** Value in the index table (if retrieveInlineValues is true) */
  inlineValue?: U;
}

export interface IndexGetOpts {
  /**
   * True to retrieve the associated values from the main table. Defaults to false.
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

export type PrimaryKey = string;
export type IndexId = string;
export type IndexKey = string;

export interface IndexerOutputEntry<U> {
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

export type Indexer<T, U> = (value: T) => IndexerOutputEntry<U>[];

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
   * Atomically modify an item in the store. If the key is not found, the
   * function will be called with undefined as the argument. If the function
   * returns undefined, the key will be deleted. Otherwise, the key will be set
   * to the return value of the function. It returns the final value of the key
   * in the store.
   */
  async modify(key: PrimaryKey, fn: (value: T | undefined) => T | undefined): Promise<T | undefined> {
    assertRuntime();
    return this.backingStore.modify(key, fn);
  }

  /**
   * Enumerate all keys in the store. Note that new keys that are added during
   * this process are not guaranteed to be included in the result, and keys
   * deleted during this process are not guaranteed to be excluded. The only
   * guarantee is that all keys that existed at the start of the process, that
   * have not been deleted at any point during the process, will be included in
   * the result.
   *
   * Note that the underlying algorithm (for a postgres store) is to fetch the
   * keys lazily in batches.
   */
  allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey> {
    assertRuntime();
    return this.backingStore.allKeys(opts);
  }
}

interface IndexInfo<T> {
  id: ID;
  tableName: string;
  indexer: Indexer<T, any>;
}

// Initialize the pg-promise library
const pgp = pgPromise();
registerTeardownHandler(() => pgp.end());

type Pool = IDatabase<{}>;

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
    if (result.length === 0) {
      return undefined;
    }
    return result[0].value;
  }

  async has(key: PrimaryKey): Promise<boolean> {
    assertRuntime();
    const pool = await this.getOrCreatePool();
    const result = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM ${this.primaryTableName} WHERE key = $1)`, [key]);
    return result[0].exists;
  }

  async set(key: PrimaryKey, value: T): Promise<void> {
    assertRuntime();
    const pool = await this.getOrCreatePool();

    const queries: { query: QueryParam, values: any[] }[] = [];

    // Insert or update in main table
    queries.push({
      query: `
        INSERT INTO ${this.primaryTableName} (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2 WHERE ${this.primaryTableName}.key = $1;
      `,
      values: [key, JSON.stringify(value)]
    });

    for (const { tableName, indexer } of this.indexes) {
      // Delete all old entries in index table for given object key
      queries.push({
        query: `DELETE FROM ${tableName} WHERE key = $1;`,
        values: [key]
      });

      // Get all index keys and their corresponding inline values using the indexer function
      for (const { indexKey, inlineValue } of indexer(value)) {
        // Insert new index rows for each index key and inline value
        queries.push({
          query: `INSERT INTO ${tableName} (index_key, key, inline_value) VALUES ($1, $2, $3);`,
          values: [indexKey, key, JSON.stringify(inlineValue)]
        });
      }
    }

    // Use a transaction to execute all the queries
    await pool.tx(async t => {
      const batch = queries.map(q => t.none(q.query, q.values));
      await t.batch(batch);
    });
  }

  async del(key: PrimaryKey): Promise<void> {
    assertRuntime();
    const pool = await this.getOrCreatePool();

    const queries: { query: string, values: any[] }[] = [];

    // Loop through the indexes and delete the related entries in the index tables
    for (const { tableName } of this.indexes) {
      queries.push({
        query: `DELETE FROM ${tableName} WHERE key = $1;`,
        values: [key]
      });
    }

    // Delete from main table
    queries.push({
      query: `DELETE FROM ${this.primaryTableName} WHERE key = $1;`,
      values: [key]
    });

    // Use a transaction to execute all the queries
    await pool.tx(async t => {
      const batch = queries.map(q => t.none(q.query, q.values));
      await t.batch(batch);
    });
  }

  async modify(key: PrimaryKey, fn: (value: T | undefined) => T | undefined): Promise<T | undefined> {
    assertRuntime();
    const pool = await this.getOrCreatePool();

    let newValue: T | undefined;
    const queries: { query: string, values: any[] }[] = [];

    // Start a transaction and retrieve the current value
    await pool.tx(async t => {
      const result = await t.oneOrNone(
        `SELECT value FROM ${this.primaryTableName} WHERE key = $1 FOR UPDATE`, [key]
      );

      const existingValue = result ? result.value : undefined;

      // Apply the modification function
      newValue = fn(existingValue);

      if (newValue === undefined) {
        // Delete the record if the new value is undefined
        queries.push({
          query: `DELETE FROM ${this.primaryTableName} WHERE key = $1;`,
          values: [key]
        });

        // Delete from index tables as well
        for (const { tableName } of this.indexes) {
          queries.push({
            query: `DELETE FROM ${tableName} WHERE key = $1;`,
            values: [key]
          });
        }
      } else {
        // Update the record
        queries.push({
          query: `
            INSERT INTO ${this.primaryTableName} (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2 WHERE ${this.primaryTableName}.key = $1;
          `,
          values: [key, JSON.stringify(newValue)]
        });

        // Handle index tables
        for (const { tableName, indexer } of this.indexes) {
          // Delete old index entries
          queries.push({
            query: `DELETE FROM ${tableName} WHERE key = $1;`,
            values: [key]
          });

          // Insert updated index entries
          for (const { indexKey, inlineValue } of indexer(newValue)) {
            queries.push({
              query: `INSERT INTO ${tableName} (index_key, key, inline_value) VALUES ($1, $2, $3);`,
              values: [indexKey, key, JSON.stringify(inlineValue)]
            });
          }
        }
      }

      // Execute the batched queries
      const batch = queries.map(q => t.none(q.query, q.values));
      await t.batch(batch);
    });

    return newValue;
  }


  async *allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey> {
    assertRuntime();
    const pool = await this.getOrCreatePool();
    const batchSize = opts?.batchSize || 100; // default batch size of 100 if not specified

    let lastKey: PrimaryKey | null = null;

    while (true) {
      // Retrieve the keys in batches
      let result: any;
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

      const keys = result.map((row: any) => row.key) as PrimaryKey[];

      // If no more keys, then exit the loop
      if (keys.length === 0) {
        break;
      }

      // Yield the batch of keys
      yield* keys;

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
    let pool: pgPromise.IDatabase<{}> | undefined;

    // A retry loop to connect to the database. This is necessary because the
    // database may not be ready yet when the store is created, especially if
    // the store is created in a docker-compose network where we're launching
    // all the services roughly at the same time.
    while (true) {
      try {
        const newPool = pgp({ host, port, user, password, database });
        pool = newPool;
        await this.seedDatabase(pool);
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
            -- The index_key column is used to store the index key
            index_key TEXT,
            -- The key column is used to store the primary key of the item
            key TEXT REFERENCES ${this.primaryTableName}(key),
            inline_value jsonb
          )
        `);

        // Create index on indexKey column for faster searches
        await postgresPool.query(`
          CREATE INDEX IF NOT EXISTS idx_${index.tableName}_index_key
          ON ${index.tableName} (index_key)
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

    const retrieveValues = opts?.retrieveValues ?? false;
    const retrieveInlineValues = opts?.retrieveInlineValues ?? true;

    // Construct the SQL query based on the options.
    let parameters: any[] = [indexKey];

    let toSelect = ['index_table.index_key', 'index_table.key'];
    if (retrieveInlineValues) toSelect.push('index_table.inline_value');
    if (retrieveValues) toSelect.push('main_table.value');

    let query = `
      SELECT ${toSelect.join(', ')}
      FROM ${index.tableName} AS index_table`

    if (retrieveValues) {
      query += `
        JOIN ${this.primaryTableName} AS main_table
        ON index_table.key = main_table.key`
    }

    query += `
      WHERE index_table.index_key = $1`

    const pool = await this.getOrCreatePool();
    const result = await pool.query(query, parameters);

    return result.map((row: any) => {
      const result: IndexEntry<T, any> = { key: row.key }
      if (retrieveValues) result.value = row.value;
      if (retrieveInlineValues) {
        if (row.inline_value !== null) {
          result.inlineValue = row.inline_value;
        } else {
          result.inlineValue = undefined;
        }
      }
      return result;
    });
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
  async *allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey> {
    yield* this.data.keys();
  }
}

registerTestFunction('store.test basic', id => {
  const store = new Store(id);
  return async () => {
    // Wipe the store, in case there are outstanding keys from previous requests
    for await (const key of store.allKeys()) {
      await store.del(key);
    }

    console.log('Starting store tests...');

    // Testing store.set and store.get
    console.log('Testing store.set and store.get...');
    await store.set('key1', { name: 'Alice', age: 30 });
    let retrievedValue = await store.get('key1');
    assert.deepEqual(retrievedValue, { name: 'Alice', age: 30 }, 'Failed to set or get value');

    // Testing store.modify
    console.log('Testing store.modify...');
    let modifiedValue = await store.modify('key1', value => ({...value, age: 31}));
    assert.deepEqual(modifiedValue, { name: 'Alice', age: 31 }, 'Failed to modify value');

    // Testing store.has
    console.log('Testing store.has...');
    let exists = await store.has('key1');
    assert(exists, 'Failed to detect key');

    // Testing store.del
    console.log('Testing store.del...');
    await store.del('key1');
    retrievedValue = await store.get('key1');
    assert.equal(retrievedValue, undefined, 'Failed to delete value');

    // Test modifying non-existent key
    console.log('Testing modifying non-existent key...');
    modifiedValue = await store.modify('key1', value => ({name: 'Bob', age: 32}));
    assert.deepEqual(modifiedValue, { name: 'Bob', age: 32 }, 'Failed to modify non-existent key');

    // Enumerating keys
    console.log('Enumerating keys...');
    await store.set('key2', {name: 'Eve', age: 25});
    let keys = [];
    for await (const key of store.allKeys()) {
        keys.push(key);
    }
    assert.deepEqual(keys, ['key1', 'key2'], 'Failed to enumerate keys');

    // Testing store with undefined value (deletion)
    console.log('Testing store with undefined value (deletion)...');
    await store.set('key1', undefined);
    retrievedValue = await store.get('key1');
    assert.equal(retrievedValue, undefined, 'Failed to delete value by setting undefined');

    console.log('All tests passed');
  }
});


interface Message {
  text: string;
  from: string;
  to: string[];
}

registerTestFunction('store.test indexers', id => {
  assertStartupTime();

  const store = new Store<Message>(id`store`)

  // Sample where each value yields a single index entry
  const fromIndex = new store.Index(id`from.v1`, (value) => [{
    indexKey: value.from,
    inlineValue: { to: value.to }
  }]);

  // Sample where each value may yield multiple index entries
  const toIndex = new store.Index(id`to.v1`, (value) => value.to.map(to => ({
    indexKey: to,
    inlineValue: { from: value.from }
  })));

  return async () => {
    console.log('Starting indexers tests...');

    // Wipe the store, in case there are outstanding keys from previous requests
    for await (const key of store.allKeys()) {
      await store.del(key);
    }

    // Setting values in the store
    await store.set('1', { from: 'Alice', to: ['Bob'], text: 'Hello' });
    await store.set('2', { from: 'Alice', to: ['Charlie', 'Dave'], text: 'World' });
    await store.set('3', { from: 'Charlie', to: ['Bob', 'Alice'], text: '!' });

    // What messages are from Alice?
    console.log('Testing fromIndex...');
    let fromAlice = await fromIndex.get('Alice');
    assert.deepEqual(fromAlice, [{
      key: '1',
      inlineValue: { to: ['Bob'] },
    }, {
      key: '2',
      inlineValue: { to: ['Charlie', 'Dave'] },
    }]);

    // What messages are to Bob?
    console.log('Testing toIndex...');
    let toBob = await toIndex.get('Bob');
    assert.deepEqual(toBob, [{
      key: '1',
      inlineValue: { from: 'Alice' },
    }, {
      key: '3',
      inlineValue: { from: 'Charlie' },
    }]);

    // What messages are from Charlie? (with values)
    console.log('Testing retrieval of values along with index...');
    let fromCharlieWithValues = await fromIndex.get('Charlie', { retrieveValues: true });
    assert.deepEqual(fromCharlieWithValues, [{
      key: '3',
      inlineValue: { to: ['Bob', 'Alice'] },
      value: { from: 'Charlie', to: ['Bob', 'Alice'], text: '!' },
    }]);

    console.log('All indexer tests passed');
  }
});
