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

There is also a special persona called "build" which is executed at build time.
The build persona is meant to set up the IaC artifacts that lead to the
setup and deployment of the other personas.
*/

import { ID } from "./id";

export interface Persona {
  id: ID;
  host: PersonaHost;
  entryPoint: () => void;
}

const registeredPersonas: Record<string, Persona> = {};

// Undefined if we're in the startup phase and so haven't started running the
// current persona yet.
export let currentPersona: Persona | undefined;

// The persona engine is the environment in which the persona is running. For
export type PersonaHost =
  | 'node' // The persona is designed for a node.js process
  | 'browser' // The persona is designed for the browser
  | 'build' // The persona is designed for a node.js process at build time (there is only one of these)
  | 'none' // The persona is non-executional in nature, such as a database server

export function definePersona(id: ID, host: PersonaHost, entryPoint: () => void): Persona {
  if (registeredPersonas.hasOwnProperty(id.value)) {
    throw new Error(`Persona with ID ${id} already registered`);
  }

  const persona: Persona = { id, entryPoint, host };
  registeredPersonas[id.value] = persona;
  return persona;
}

export function runPersona(id: ID): void {
  const persona = registeredPersonas[id.value];
  if (!persona) {
    throw new Error(`No persona registered with ID ${id}`);
  }
  // The expectation is that personas are only run once, at the end of startup.
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