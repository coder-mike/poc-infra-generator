import { ID, idToFilePath, rootId } from "./id";
import path from 'path'
import fs from 'fs'
import { currentPersona, definePersona } from "./persona";

const callbacks: Array<() => void> = [];

// It may be a bit of a hack to use a root ID here, but the build persona is
// so universal to everything else that it seems like a reasonable choice.
export const buildPersona = definePersona(rootId('build'), 'build', () => {
  for (const callback of callbacks) {
    callback();
  }
});

/**
 * Register a callback to be executed at build time. Build time callbacks are
 * not executed in any particular order.
 */
export function onBuild(callback: () => void) {
  callbacks.push(callback);
}

export function assertBuildTime() {
  if (currentPersona !== buildPersona) {
    throw new Error(`This function can only be called at build time`);
  }
}

export interface File {
  // Get the filename of the file (only available at build time)
  getFilename(): string;
}

// Define a build-time file
export function defineFile(id: ID): File {
  const filepath = path.resolve('build', idToFilePath(id));
  const directoryPath = path.dirname(filepath);
  let directoryCreated = false;

  return {
    /**
     * Get the path to the file. This function can only be called at build time.
     * The directory containing the file will be created if it does not exist.
     */
    getFilename: () => {
      assertBuildTime();
      if (!directoryCreated) {
        fs.mkdirSync(directoryPath, { recursive: true })
        directoryCreated = true;
      }
      return filepath;
    }
  }
}