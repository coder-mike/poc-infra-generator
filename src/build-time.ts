import { rootId } from "./id";
import { currentPersona, Persona } from "./persona";

const callbacks: Array<() => void> = [];

// Represents a value that's only available at build time
export class BuildTimeValue<T> {
  /**
   * Create a BuildTimeValue.
   *
   * @param get A function that returns the value. This function will only be
   * called at build time.
   */
  constructor(private _get: () => T) {}

  /** Get the value of this BuildTimeValue */
  get(): T {
    assertBuildTime();
    return this._get();
  }

  /** BuildTimeValueOr to a BuildTimeValue */
  static create<T>(value: T | BuildTimeValue<T>): BuildTimeValue<T> {
    return (value instanceof BuildTimeValue
      ? value
      : new BuildTimeValue(() => value)
    );
  }

  /** Get the value of a BuildTimeValue */
  static get<T>(value: BuildTimeValueOr<T>): T {
    assertBuildTime();
    return value instanceof BuildTimeValue ? value.get() : value;
  }

  /**
   * Create a new BuildTimeValue by applying a function to the value of this
   * BuildTimeValue.
   */
  bind<U>(fn: (value: T) => U): BuildTimeValue<U> {
    return new BuildTimeValue(() => fn(this.get()));
  }
}

// A value that might be available at build time, or might be a constant
export type BuildTimeValueOr<T> = T | BuildTimeValue<T>;

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