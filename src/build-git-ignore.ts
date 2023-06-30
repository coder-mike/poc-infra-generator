import path from "path";
import { BuildTimeFile } from "./build-time-file";
import { rootId } from "./id";
import { assertStartupTime } from "./persona";
import { BuildTimeValue } from "./build-time";

const files = new Set<string>();

new BuildTimeFile(rootId('gitignore'), {
  filepath: 'build/.gitignore',
  content: new BuildTimeValue(() => [...files].join('\n'))
});

export function gitIgnorePath(filepath: string) {
  assertStartupTime();
  // Relative to the directory in which the .gitignore file is located
  const relativePath = path.relative(path.resolve('build'), filepath)
  if (relativePath.startsWith('..')) {
    throw new Error(`File ${filepath} is not in the build directory`);
  }

  if (files.has(relativePath)) {
    throw new Error(`File ${filepath} already ignored`);
  }
  files.add(relativePath);
}