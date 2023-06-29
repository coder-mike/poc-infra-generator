import { ID, idToFilePath } from "./id";
import path from 'path'
import fs from 'fs'
import { BuildTimeValue, BuildTimeValueOr, assertBuildTime, onBuild } from "./build-time";
import { assertStartupTime } from "./persona";

interface Opts {
  /** Content of the file. Evaluated at build time. */
  content?: BuildTimeValueOr<string | Buffer>;

  /** File extension including dot. Not used if filepath is set. */
  ext?: string;

  /**
   * Path and filename of the file. If omitted, it will default to use the id
   * and ext to generate a path. Path is relative to current working directory
   * which is assumed to be the project directory.
   */
  filepath?: string;
}

const registeredPaths = new Map<string, ID>();

// Define a build-time file
export class BuildTimeFile {
  public filepath: string;
  private dirCreated = false;

  constructor (public id: ID, opts?: Opts) {
    assertStartupTime();
    this.filepath = path.resolve(opts?.filepath ?? path.join('build', idToFilePath(id) + (opts?.ext ?? '')));
    if (registeredPaths.has(this.filepath)) {
      throw new Error(`BuildTimeFile with path ${this.filepath} already exists (id: ${registeredPaths.get(this.filepath)}))`);
    }
    registeredPaths.set(this.filepath, id);

    const content = opts?.content;
    if (content) {
      onBuild(() => {
        this.forceDir()
        fs.writeFileSync(this.filepath, BuildTimeValue.get(content))
      });
    }
  }

  // Create the directory for the file if it doesn't exist
  public forceDir() {
    assertBuildTime();
    const dirName = path.dirname(this.filepath);
    if (!this.dirCreated && !fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
    this.dirCreated = true;
  }
}