import { DockerService } from "./docker-compose";
import { DockerFile } from "./docker-file";
import { ID } from "./id";
import { assertStartupTime, Persona } from "./persona";

// Register a callback to be run when the system is deployed. Each callback is
// run in a separate docker container.
export function onDeploy(id: ID, callback: () => void) {
  assertStartupTime();

  /*
  This function works by creating a docker file that invokes the application
  entrypoint of the current application. The application running in that docker
  container should specialize its behavior based on the new persona created. The
  persona has an ID unique to this callback, so the application knows to run
  this callback when it runs in that docker container.
  */


  const appEntryScript = require.main?.path;
  if (!appEntryScript) {
    throw new Error('Could not determine app entry script');
  }

  const persona = new Persona(id, 'node', callback);

  const dockerImage = new DockerFile(id, [
    { op: 'FROM', image: 'node:14' },
    { op: 'WORKDIR', path: '/usr/src/app' },
    { op: 'COPY', src: 'package*.json', dest: './' },
    { op: 'RUN', commands: ['npm install'] },
    { op: 'COPY', src: '.', dest: '.' },
    { op: 'CMD', command: 'node', params: [appEntryScript] },
  ])

  return new DockerService(id, {
    dockerImage,
    environment: {
      PERSONA: () => persona.environmentVariableName,
    }
  })
}