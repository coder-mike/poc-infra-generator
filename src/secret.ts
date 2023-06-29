import { BuildTimeValue, BuildTimeValueOr } from "./build-time";
import { ID, idToSafeName } from "./id";
import { assertNotStartup, currentPersona } from "./persona";
import { assertNever, unexpected } from "./utils";

export const secrets: Record<string, BuildTimeValue<string>> = {}

export class Secret<T> extends BuildTimeValue<T> {
  private environmentVariableName: string;

  constructor (id: ID, private value: BuildTimeValueOr<T>) {
    super (() => BuildTimeValue.get(value))
    this.environmentVariableName = idToSafeName(id);

    if (secrets.hasOwnProperty(this.environmentVariableName)) {
      throw new Error(`Secret ${this.environmentVariableName} already defined (${id})`);
    }

    secrets[this.environmentVariableName] = this.bind(JSON.stringify)
  }

  // Override BuildTimeValue.get because the value can be accessed at runtime as well
  get(): T {
    assertNotStartup();
    const host = currentPersona?.host;
    switch (host) {
      case undefined: throw new Error(`Secret ${this.environmentVariableName} cannot be accessed at startup`);
      case 'build': return super.get();
      case 'cli':
      case 'cli-command':
      case 'node':
        return JSON.parse(process.env[this.environmentVariableName] ?? unexpected());
      case 'browser': throw new Error(`Currently no way to route secrets to a browser environment`);
      case 'none': unexpected(); // It doesn't make sense that this code is executing in a non-executional environment
      default: assertNever(host)
    }
  }
}
