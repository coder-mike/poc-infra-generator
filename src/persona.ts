/*
A persona is an experimental concept I've developed elsewhere but I'm using here
for the sake of rapid development. It is not essential to the POC, so if you
don't understand this, just ignore it.

The app is assumed to be distributed across multiple environments, such as a
client application or a server application. Each of these is called a "persona".
The same app code is run in each environment (e.g. client and server) but it's
told to behave differently in each environment by telling it what persona to use
(e.g. through an environment variable, like `PERSONA=server`). The same app is
distributed to each environment and then specializes its behavior according to
the persona in that environment.

There is also a special persona called `buildPersona` which is executed at build
time. The build persona is meant to set up the IaC artifacts that lead to the
setup and deployment of the other personas.

And there is a special persona called `inProcessPersona` which various
components will use to run in-process instead of creating the infra resources in
which to run. The in-process persona is run if the entrypoint to the app is
invoked without a persona ID. This is useful for testing and development since
it will just run the whole distributed app.
*/

import assert from "assert";
import { ID, idToSafeName, rootId } from "./id";

const registeredPersonas: Record<string, Persona> = {};

// Undefined if we're in the startup phase and so haven't started running the
// current persona yet.
export let currentPersona: Persona | undefined;

// True if no persona has been specified (including the build persona), so we're
// running everything in-process.
export const runningInProcess = process?.env?.PERSONA === undefined;

// The persona engine is the environment in which the persona is running. For
export type PersonaHost =
  | 'node' // The persona is designed for a node.js server process
  | 'cli' // The persona is an interactive terminal. There can be only one.
  | 'cli-command' // The persona is a CLI command
  | 'browser' // The persona is designed for the browser
  | 'build' // The persona is designed for a node.js process at build time (there is only one of these)
  | 'none' // The persona is non-executional in nature, such as a database server

export class Persona {
  environmentVariableValue: string;

  constructor (
    public id: ID,
    public host: PersonaHost,
    public entryPoint: () => void | Promise<void>,
    opts?: { environmentVariableValue?: string }
  ) {
    this.environmentVariableValue = opts?.environmentVariableValue ?? idToSafeName(id);

    if (registeredPersonas.hasOwnProperty(this.environmentVariableValue)) {
      throw new Error(`Persona with ID ${id} already registered (env ${this.environmentVariableValue})`);
    }

    // Only one CLI persona can be registered because when running in-process,
    // there is no to decide which CLI persona to run.
    if (host === 'cli' && Object.values(registeredPersonas).some(p => p.host === 'cli')) {
      throw new Error(`CLI persona already registered by ${Object.values(registeredPersonas).find(p => p.host === 'cli')?.id}`);
    }

    registeredPersonas[this.environmentVariableValue] = this;
  }
}

export const inProcessPersona = new Persona(rootId('inProcessPersona'), 'node', async () => {
  // The in-process persona is used for testing and development. It runs the
  // application in the same process as the test or development environment.
  // It works by executing all other persona entry points directly.
  const personasToRun = Object.values(registeredPersonas)
    .filter(p => p !== inProcessPersona && p.host === 'node');

  const promises: Promise<any>[] = [];

  for (const persona of personasToRun) {
    // Note: if the persona is async, we run them in parallel
    promises.push(Promise.resolve(persona.entryPoint())
      .catch(console.error));
  }

  // Wait for other personas to finish initializing before running the CLI. This
  // may including things such as database initialization etc that the CLI is
  // dependent on. Also any console output from these processes could interfere
  // with the CLI. For intentionally-long-running background processes, they can
  // return an eager promise and then just continue running in the background.
  await Promise.all(promises);

  const cliPersona = Object.values(registeredPersonas).find(p => p.host === 'cli');
  if (cliPersona) {
    // The CLI persona is special because it's the only one that can be run
    // interactively. So we run it last.
    await cliPersona.entryPoint();
  }
});

/**
 * Called at the end of startup to run the persona identified by the
 * the given ID or PERSONA environment variable.
 */
export function runPersona(id?: ID): void {
  let persona: Persona;
  if (id) {
    persona = registeredPersonas[idToSafeName(id)];
    if (!persona) {
      throw new Error(`No persona registered with ID ${id}`);
    }
  } else if (process.env.PERSONA) {
    const environmentVariableValue = process.env.PERSONA.trim();
    persona = registeredPersonas[environmentVariableValue];
    if (!persona) {
      throw new Error(`No persona registered ${environmentVariableValue}`);
    }
  } else {
    assert(runningInProcess);
    persona = inProcessPersona;
  }

  // The expectation is that runPersona is only executed once, at the end of startup.
  if (currentPersona) {
    throw new Error(`Already running persona ${currentPersona.id}`);
  }
  currentPersona = persona;
  Promise.resolve(persona.entryPoint())
    .catch(console.error);
}

// Assert that we're in the "startup" epoch, which is the epoch of the program
// which is meant to be deterministic across all personas.
export function assertStartupTime() {
  if (currentPersona) {
    throw new Error('This function is meant to be executed at startup');
  }
}

export function assertNotStartup() {
  if (!currentPersona) {
    throw new Error('This function is not meant to be executed at startup');
  }
}