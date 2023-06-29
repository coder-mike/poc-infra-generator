import assert from "assert";
import { ID } from "./id";
import { notImplemented } from "./utils";
import { assertStartupTime, runningInProcess } from "./persona";
import { DockerService, DockerVolume } from "./docker-compose";
import { Password } from "./password-store";

export interface StoreIndex<T> {
  // Retrieves all the items from the store that match the given index value
  get(key: IndexKey): Promise<T[]>;
}

type PrimaryKey = string;
type IndexId = string;
type IndexKey = string;

/**
 * A simple key-value store with optional indexes, backed either its private
 * postgres docker instance or an in-memory data model.
 */
export class Store<T = any> {
  indexes: Map<IndexId, {
    indexer: (value: T) => IndexKey[];
    inMemory: Map<IndexKey, Set<T>>;
  }> = new Map();
  inMemoryStore: Map<PrimaryKey, {
    value: T,
    indexKeys: Map<IndexId, IndexKey[]>
  }> = new Map(); // Only if running in-process

  postgresService: DockerService = undefined as any; // Only used if running in docker

  constructor (public id: ID) {
    assertStartupTime();

    if (runningInProcess) {
      this.inMemoryStore = new Map();
    } else {
      const password = new Password(id`password`);
      const volume = new DockerVolume(id`data`);
      this.postgresService = new DockerService(id, {
        dockerImage: 'postgres:latest',
        environment: {
          POSTGRES_PASSWORD: password
        },
        volumeMounts: [{ volume, mountPath: '/var/lib/postgresql/data' }]
      })
    }
  }

  defineIndex(id: ID, indexer: (value: T) => IndexKey[]): StoreIndex<T> {
    if (this.indexes.has(id.value)) {
      throw new Error(`Index ${id.value} already defined`);
    }

    const inMemoryIndex = new Map(); // Only used if in-memory mode
    this.indexes.set(id.value, { indexer, inMemory: inMemoryIndex });

    return {
      get: async (indexKey: IndexKey): Promise<T[]> => {
        if (runningInProcess) {
          return Array.from(inMemoryIndex.get(indexKey) ?? []);
        } else {
          notImplemented()
        }
      }
    }
  }

  // Get a JSON value from the store. Returns undefined if the key is not found.
  async get(key: PrimaryKey): Promise<T | undefined> {
    if (runningInProcess) {
      return this.getLocal(key);
    } else {
      notImplemented();
    }
  }

  // Set a JSON value in the store, or pass undefined to delete the value
  async set(key: PrimaryKey, value: T | undefined): Promise<void> {
    if (runningInProcess) {
      this.setLocal(key, value);
    } else {
      notImplemented()
    }
  }

  // Delete an entry in the store. Does nothing if the key is not found.
  async del(key: PrimaryKey): Promise<void> {
    if (runningInProcess) {
      this.delLocal(key);
    } else {
      notImplemented();
    }
  }

  // Atomically modify an item in the store
  async modify(key: PrimaryKey, fn: (value: T | undefined) => T | undefined): Promise<T | undefined> {
    if (runningInProcess) {
      // The in-memory store is already atomic
      const oldValue = this.getLocal(key);
      const newValue = fn(oldValue);
      this.setLocal(key, newValue);
      return newValue;
    } else {
      notImplemented();
    }
  }

  // Enumerate all keys in the store, in batches. Note that new keys that are
  // added during this process are not guaranteed to be included in the result,
  // and keys deleted during this process are not guaranteed to be excluded. The
  // only guarantee is that all keys that existed at the start of the process,
  // that have not been deleted at any point during the process, will be
  // included in the result.
  allKeys(opts?: { batchSize?: number }): AsyncIterableIterator<PrimaryKey[]> {
    const batchSize = opts?.batchSize ?? 100;
    if (runningInProcess) {
      return this.allKeysLocal(batchSize);
    } else {
      notImplemented();
    }
  }

  private async *allKeysLocal(batchSize: number): AsyncIterableIterator<PrimaryKey[]> {
    const keys = Array.from(this.inMemoryStore.keys());
    for (let i = 0; i < keys.length; i += batchSize) {
      yield keys.slice(i, i + batchSize);
    }
  }

  private getLocal(key: PrimaryKey): T | undefined {
    const entry = this.inMemoryStore.get(key);
    return entry?.value;
  }

  private setLocal(key: string, value: T | undefined) {
    if (value === undefined) {
      this.delLocal(key);
      return;
    }

    // Only JSON values are preserved in the store
    value = JSON.parse(JSON.stringify(value));

    // Remove from old indexes
    this.delLocal(key);

    if (value) {
      // Insert into new indexes
      const indexKeys = new Map<IndexId, IndexKey[]>();
      for (const [indexId, index] of this.indexes.entries()) {
        const keys = index.indexer(value);
        for (const indexKey of keys) {
          if (!index.inMemory.has(indexKey)) {
            index.inMemory.set(indexKey, new Set());
          }
          // Add to index
          index.inMemory.get(indexKey)!.add(value);
        }
        // Record in the store that we've added it to the index so we can remove
        // it again later without searching the indexes.
        indexKeys.set(indexId, keys);
      }

      this.inMemoryStore.set(key, { value, indexKeys });
    }
  }

  private delLocal(key: PrimaryKey) {
    const original = this.inMemoryStore.get(key);

    if (!original) {
      return;
    }

    // For each index in which the original object appears
    for (const [indexId, indexKeys] of original.indexKeys.entries()) {
      const index = this.indexes.get(indexId)!;
      // For each key in the index under which the original object appears
      for (const indexKey of indexKeys) {
        const objects = index.inMemory.get(indexKey)!;
        // Remove the original object from the index
        assert(objects.has(original.value));
        objects.delete(original.value);
        if (objects.size === 0) {
          index.inMemory.delete(indexKey);
        }
      }
    }

    this.inMemoryStore.delete(key);
  }
}