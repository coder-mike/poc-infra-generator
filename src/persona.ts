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
  | 'node' // The persona is designed for a node.js process
  | 'browser' // The persona is designed for the browser
  | 'build' // The persona is designed for a node.js process at build time (there is only one of these)
  | 'none' // The persona is non-executional in nature, such as a database server

export class Persona {
  environmentVariableName: string;

  constructor (public id: ID, public host: PersonaHost, public entryPoint: () => void) {
    this.environmentVariableName = idToSafeName(id);

    if (registeredPersonas.hasOwnProperty(this.environmentVariableName)) {
      throw new Error(`Persona with ID ${id} already registered (env ${this.environmentVariableName})`);
    }
    registeredPersonas[this.environmentVariableName] = this;
  }
}

export const inProcessPersona = new Persona(rootId('inProcessPersona'), 'node', () => {
  // The in-process persona is used for testing and development. It runs the
  // application in the same process as the test or development environment.
  // It works by executing all other persona entry points directly
  for (const persona of Object.values(registeredPersonas)) {
    // The build persona and in-process persona are special here. The assumption
    // is that we don't need to run the infra-build persona if everything is
    // in-process, since the build persona is solely for the purposes of
    // building the infra.
    if (persona === inProcessPersona || persona.host === 'build') continue;
    persona.entryPoint();
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
    const environmentVariableName = process.env.PERSONA;
    persona = registeredPersonas[environmentVariableName];
    if (!persona) {
      throw new Error(`No persona registered with environment variable name ${environmentVariableName}`);
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
  persona.entryPoint();
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