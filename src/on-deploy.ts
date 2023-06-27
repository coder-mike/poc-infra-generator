import assert from "assert";
import { DockerService } from "./docker-compose";
import { DockerFile, DockerInstruction } from "./docker-file";
import { ID } from "./id";
import { assertStartupTime, Persona } from "./persona";
import { Port } from "./port";
import path from 'path';

// Register a callback to be run when the system is deployed. Each callback is
// run in a separate docker container.
export function onDeploy(id: ID, callback: () => void, opts?: { ports?: Port[] }) {
  assertStartupTime();

  /*
  This function works by creating a docker file that invokes the application
  entrypoint of the current application. The application running in that docker
  container should specialize its behavior based on the new persona created. The
  persona has an ID unique to this callback, so the application knows to run
  this callback when it runs in that docker container.
  */

  let entryScript = require.main && path.resolve(require.main.path, require.main.filename);
  if (!entryScript) {
    throw new Error('Could not determine app entry script');
  }

  const persona = new Persona(id, 'node', callback);

  entryScript = path.relative(process.cwd(), entryScript)

  // Normalize the path to use forward slashes.
  entryScript = entryScript.replace(/\\/g, '/');

  const commands: DockerInstruction[] = [
    { op: 'FROM', image: 'node:20' },
    { op: 'WORKDIR', path: '/usr/src/app' },
    { op: 'COPY', src: '../package*.json', dest: './' },
    { op: 'RUN', commands: ['npm install'] },
  ]

  // Running under ts-node (note: this code path may be executed when running
  // in-process, but in case it isn't, we need to have sensible behavior).
  if (path.extname(entryScript) === '.ts') {
    assert(entryScript.startsWith('src'));
    commands.push(
      { op: 'COPY', src: '../src', dest: './src' },
      { op: 'CMD', command: 'npx', params: ['ts-node', entryScript] },
    );
  }
  // Running under node
  else {
    assert(path.extname(entryScript) === '.js');
    assert(entryScript.startsWith('dist'));
    commands.push(
      { op: 'COPY', src: '../dist', dest: './dist' },
      { op: 'CMD', command: 'node', params: [entryScript] },
    );
  }

  // Note: the host paths are relative to the docker-compose.yml file which is
  // in the `build` directory, so there is an additional `..` in the path.
  const dockerImage = new DockerFile(id`Dockerfile`, commands)

  return new DockerService(id, {
    dockerImage,
    environment: {
      PERSONA: () => persona.environmentVariableValue,
    },
    ports: opts?.ports,
  })
}