import { ID } from "./id";
import fs from 'fs'
import { File, assertBuildTime, defineFile, onBuild } from "./build-time";
import { assertStartupTime } from "./persona";

/**
 * A key-value store which is only accessible at build time (backed by a file in
 * the build folder), to be used for storing values that need to be consistent
 * across multiple builds.
 */
export class CompileTimeStore {
  private file: File
  private contents: { [key: string]: string };

  constructor (public id: ID) {
    assertStartupTime();
    this.file = defineFile(id);
  }

  get(key: ID): any {
    assertBuildTime();
    this.cacheContents();
    return this.contents[key.value]
  }

  set(key: ID, value: any): void {
    value = JSON.parse(JSON.stringify(value));
    assertBuildTime();
    this.cacheContents();
    this.contents[key.value] = value;
    this.flush();
  }

  has(key: ID): boolean {
    assertBuildTime();
    this.cacheContents();
    return this.contents.hasOwnProperty(key.value);
  }

  getOrInsert<T>(key: ID, valueLazy: () => T): T {
    assertBuildTime();
    if (this.has(key)) {
      return this.get(key);
    } else {
      const value = valueLazy();
      this.set(key, value);
      return value;
    }
  }

  private cacheContents() {
    if (!this.contents) {
      const filename = this.file.getFilename();
      if (fs.existsSync(filename)) {
        this.contents = JSON.parse(fs.readFileSync(filename, 'utf8'));
      } else {
        this.contents = Object.create(null);
      }
    }
  }

  private flush() {
    const filename = this.file.getFilename();
    fs.writeFileSync(filename, JSON.stringify(this.contents));
  }
}