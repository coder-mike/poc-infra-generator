import { rootId } from "./id";
import { currentPersona, Persona } from "./persona";

const callbacks: Array<() => void> = [];

// A value that's only available at build time
export type BuildTimeValue<T> = { get: () => T };
export const buildTimeValue = <T>(get: () => T): BuildTimeValue<T> => ({ get });

// It may be a bit of a hack to use a root ID here, but the build persona is
// so universal to everything else that it seems like a reasonable choice.
export const buildPersona = new Persona(rootId('build-infra'), 'build', () => {
  for (const callback of callbacks) {
    callback();
  }
}, { environmentVariableValue: 'build-infra' });

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
