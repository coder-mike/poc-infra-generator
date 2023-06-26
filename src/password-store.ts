import { ID, rootId } from "./id";
import crypto from 'crypto'
import { BuildTimeStore } from "./build-time-store";
import { Secret } from "./docker-compose";

const passwordStore = new BuildTimeStore<string>(rootId('passwords'))

export class Password extends Secret<string> {
  constructor (id: ID) {
    // Fetch the password from the password store (a file in the build folder) or
    // generate a new one.
    super(id, () =>
      passwordStore.getOrInsert(id, () =>
        crypto.randomBytes(32).toString('hex'))
    );
  }
}
