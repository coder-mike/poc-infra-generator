import { ID } from "./id";
import fs from 'fs'
import { assertBuildTime } from "./build-time";
import { assertStartupTime } from "./persona";
import { BuildTimeFile } from "./build-time-file";

/**
 * A key-value store which is only accessible at build time (backed by a file in
 * the build folder), to be used for storing values that need to be consistent
 * across multiple builds.
 */
export class BuildTimeStore<T> {
  private file: BuildTimeFile
  private contents?: { [key: string]: T };

  constructor (public id: ID) {
    assertStartupTime();
    this.file = new BuildTimeFile(id, { ext: '.json' });
  }

  get filepath() { return this.file.filepath; }

  at(key: ID) {
    return {
      get: () => this.get(key),
      set: (value: any) => this.set(key, value),
      exists: () => this.has(key),
      getOrInsert: (valueLazy: () => any) => this.getOrInsert(key, valueLazy)
    }
  }

  get(key: ID): any {
    assertBuildTime();
    this.cacheContents();
    return this.contents![key.value]
  }

  set(key: ID, value: T): void {
    value = JSON.parse(JSON.stringify(value));
    assertBuildTime();
    this.cacheContents();
    this.contents![key.value] = value;
    this.flush();
  }

  has(key: ID): boolean {
    assertBuildTime();
    this.cacheContents();
    return this.contents!.hasOwnProperty(key.value);
  }

  getOrInsert(key: ID, valueLazy: () => T): T {
    assertBuildTime();
    this.cacheContents();
    if (this.has(key)) {
      return this.get(key);
    } else {
      const value = valueLazy();
      this.set(key, value);
      return value;
    }
  }

  keys(): string[] {
    assertBuildTime();
    this.cacheContents();
    return Object.keys(this.contents!);
  }

  values(): T[] {
    assertBuildTime();
    this.cacheContents();
    return Object.values(this.contents!);
  }

  private cacheContents() {
    if (!this.contents) {
      const filepath = this.file.filepath;
      if (fs.existsSync(filepath)) {
        this.contents = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      } else {
        this.contents = {};
      }
    }
  }

  private flush() {
    const filename = this.file.filepath;
    this.file.forceDir();
    fs.writeFileSync(filename, JSON.stringify(this.contents, null, 4));
  }
}