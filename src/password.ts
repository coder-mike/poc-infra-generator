import { ID, rootId } from "./id";
import crypto from 'crypto'
import { BuildTimeStore } from "./build-time-store";
import { gitIgnorePath } from "./build-git-ignore";
import { Secret } from "./secret";
import { BuildTimeValue } from "./build-time";

const passwordStore = new BuildTimeStore<string>(rootId('passwords'))
gitIgnorePath(passwordStore.filepath)

/**
 * A password that is generated once and stored in the password store.
 *
 * The password is randomly generated and is 64 hex characters long.
 */
export class Password extends Secret<string> {
  constructor (id: ID) {
    // Fetch the password from the password store (a file in the build folder) or
    // generate a new one.
    super(id, new BuildTimeValue(() =>
      passwordStore.getOrInsert(id, () =>
        crypto.randomBytes(32).toString('hex')))
    );
  }
}
