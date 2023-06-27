import { ID, idToFilePath } from "./id";
import path from 'path'
import fs from 'fs'
import { assertBuildTime, onBuild } from "./build-time";
import { assertStartupTime } from "./persona";

// Define a build-time file
export class BuildTimeFile {
  public filepath: string;
  private dirCreated = false;

  /**
   * @param ext File extension including dot
   */
  constructor (public id: ID, ext?: string, content?: () => string | Buffer) {
    assertStartupTime();
    const filepath = path.resolve('build', idToFilePath(id) + ext);
    this.filepath = filepath;
    if (content) {
      onBuild(() => {
        this.forceDir()
        fs.writeFileSync(this.filepath, content())
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