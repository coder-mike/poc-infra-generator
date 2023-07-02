import assert from "assert";
import { DockerService } from "./docker-compose";
import { DockerFile, DockerInstruction } from "./docker-file";
import { ID } from "./id";
import { assertStartupTime, Persona } from "./persona";
import { Port } from "./port";
import path from 'path';

/**
 * Register a callback to be run when the system is deployed. Each callback is
 * run in a separate docker container (unless the system is running in-process).
 *
 * When running in-process, the callback is run at startup, along with all other
 * callbacks registered with onDeploy. The system will wait for the callback to
 * complete before starting the interactive CLI, if there is one. If the
 * callback is intended to be a long-running background process, it's better to
 * return an eager promise and then continue running in the background.
 *
 * If ports are specified, these are exposed on the host machine and forwarded
 * to the container. This is required if you want to access the container from
 * outside the docker-compose network (e.g. a CLI).
 */
export class Worker extends DockerService {
  constructor (
    id: ID,
    callback: () => void | Promise<void>,
    opts?: { ports?: Port[] }
  ) {
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

    const persona = new Persona(id, 'node-daemon', callback);

    entryScript = path.relative(process.cwd(), entryScript)

    // Normalize the path to use forward slashes.
    entryScript = entryScript.replace(/\\/g, '/');

    const commands: DockerInstruction[] = [
      { op: 'FROM', image: 'node:20' },
      { op: 'WORKDIR', path: '/usr/src/app' },
      { op: 'COPY', src: '../package*.json', dest: './' },
      { op: 'RUN', commands: ['npm install'] },
      { op: 'COPY', src: '.', dest: '.' }, // Everything except what's in .dockerignore
    ]

    // Running under ts-node (note: this code path may be executed when running
    // in-process, but in case it isn't, we need to have sensible behavior).
    if (path.extname(entryScript) === '.ts') {
      commands.push(
        { op: 'CMD', command: 'npx', params: ['ts-node', entryScript] },
      );
    }
    // Running under node
    else {
      assert(path.extname(entryScript) === '.js' || path.extname(entryScript) === '.mjs');
      commands.push(
        { op: 'CMD', command: 'node', params: [entryScript] },
      );
    }

    // Note: the host paths are relative to the docker-compose.yml file which is
    // in the `build` directory, so there is an additional `..` in the path.
    const dockerImage = new DockerFile(id`Dockerfile`, commands)

    super(id,  {
      dockerImage,
      environment: {
        PERSONA: persona.environmentVariableValue,
      },
      ports: opts?.ports,
    })
  }
}