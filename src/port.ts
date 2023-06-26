import { assertBuildTime } from "./build-time";
import { BuildTimeStore } from "./build-time-store";
import { Secret } from "./docker-compose";
import { ID, rootId } from "./id";

// Only used when there's no existing build cache, otherwise look at
// `nextPortNumber` in the `ports` file in the build folder.
const START_OF_PORT_RANGE = 35000;

// Using a build time store to maintain some consistency of port numbers between
// consecutive builds.
const portStore = new BuildTimeStore(rootId('ports'))

// An element in the store which keeps track of the next port number to allocate
const nextPortNumber = portStore.at(rootId('nextPortNumber'));

// Each `Port` allocates a new number in a build-time-persistent "ports" file,
// to avoid collisions with other containers and to keep the port numbers
// consistent between builds.
//
// It inherits from `Secret` which is used to leverage the machinery that passes
// the secret to the container at runtime. So `port.get()` can be executed at
// build time or runtime in any persona.
export class Port extends Secret<number> {
  constructor (id: ID) {
    super(id, () => {
      // Port numbers are allocated at build time
      assertBuildTime();
      if (!nextPortNumber.exists()) {
        nextPortNumber.set(START_OF_PORT_RANGE);
      }
      // If we've already allocated a port for this ID, return it
      if (portStore.has(id)) {
        return portStore.get(id);
      }
      // Otherwise, allocate a new port number
      const port = nextPortNumber.get();
      nextPortNumber.set(port + 1);
      portStore.set(id, port);
      return port;
    });
  }
}

