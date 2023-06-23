import { ID, rootId } from "./id";
import crypto from 'crypto'
import { CompileTimeStore } from "./compile-time-store";
import { defineSecret } from "./docker";

interface Password {
  /** Get the password (only at runtime or build time, not startup) */
  get: () => string;
}

const passwordStore = new CompileTimeStore(rootId('passwords'))

export function definePassword(id: ID): Password {
  // Fetch the password from the password store (a file in the build folder) or
  // generate a new one.
  const getPassword = () =>
    passwordStore.getOrInsert(id, () =>
      crypto.randomBytes(32).toString('hex'));
  const secret = defineSecret(id, getPassword);
  return {
    get: () => secret.get()
  }
}
