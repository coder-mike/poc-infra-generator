# Proof of concept: Infra Generator

Author: Michael Hunter
License: MIT

Infra Generator is a proof-of-concept library designed to streamline the creation and orchestration of distributed systems. Through its versatile architecture, developers can efficiently encapsulate components, leverage dependency injection, and maintain type-safety. The library provides tools to programmatically define infrastructure configuration, server logic, and client logic, while automatically generating necessary Docker and Docker Compose files to seamlessly deploy multiple architectural components.

## Disclaimer

Please note that this library is a proof-of-concept and is not intended for production use. It is provided as-is, and the author makes no warranties regarding its functionality, completeness, or reliability. Use it at your own risk. The author shall not be responsible for any damages or loss resulting from the use of this library.

## Prerequisites

Install docker and docker-compose.

## Install

```sh
npm install @coder-mike/poc-infra-generator
```

## Example Usage

The following is an example that creates an Express API server called the "customer-server" backed by a postgres database containing a table of customers, and an example client application that sends a record to the database through the API and reads it back again.

The following is aspirational, since the library is a WIP:

```ts
import { rootId, Store, ApiServer, ID, runPersona } from '@coder-mike/poc-infra-generator';

interface Customer {
  id: string;
  name: string;
}

interface CustomerServer {
  postCustomer(customer: Customer): Promise<void>;
  getCustomer(id: string): Promise<Customer>;
}

const id = rootId('my-app');

// Create the server (which will create its own database)
const server = createCustomerServer(id`customer-server`);

// Create the client, with injected reference to server
createExampleClient(id`example-client`, server);

// Run the persona defined by the current file
runPersona();

function createCustomerServer(id: ID): CustomerServer {
  // Create a store for customers (backed by postgres)
  const db = new Store(id`db`);

  // Create an Express API server
  const server = new ApiServer(id`api`);

  // Endpoint to post a customer to the database
  const postCustomer = server.defineEndpoint(
    '/api/customer',
    async (customer: Customer) => {
      await db.set(customer.id, customer);
    },
    { method: 'POST' }
  );

  // Endpoint to get a customer from the database
  const getCustomer = server.defineEndpoint(
    '/api/customer',
    async (id: string) => {
      return db.get(id);
    },
    { method: 'GET' }
  );

  return {
    postCustomer,
    getCustomer,
  }
}

function createExampleClient(id: ID, server: CustomerServer) {
  // The client will just be a docker container that runs at deployment time
  onDeploy(id, async () => {
    // Save customer to the database via the API server
    await server.postCustomer({ id: '1', name: 'John Doe' });

    // Load customer from the database via the API server
    const customer = await server.getCustomer('1');

    console.log(`Loaded customer: ${JSON.stringify(customer)}`);
  })
}
```

To run this example:

```sh
# 1. Build the example. This also generates the docker files and docker-compose file
npm run example:build

# (2. Note: Please make sure docker desktop is running)

# 3. Run the whole distributed system (client, server, and database)
docker-compose -f build/docker-compose.yml up
```

Or to run the whole example in-process instead of using docker:

```sh
# Run everything in-process and in-memory. This is useful for debugging.
npm run example:start:in-process
```

Note: it's recommended to also include a `.dockerignore` file in your project to prevent the `node_modules` directory from being copied into the docker containers. This will make the docker images smaller and faster to build.

### Advantages demonstrated in this example

There are a few key points to highlight in this example before I explain it:

- This example is a single script (representative of a single application of many files) but contains code that executes in 3 different places: the client, the server, and build-time configuration of the infra.

- The `db` in `createCustomerServer` is fully **encapsulated** -- it's a local variable that's not accessible to other parts of the system (e.g. the client). The pattern proposed in this POC makes encapsulation of infra components possible in a way that's a lot harder with traditional infra patterns (e.g. writing Terraform scripts).

- The `server` in `createExampleClient` is passed in as a parameter. This is an example of **dependency injection** at the infra level.

- The client's connection to the server here is encapsulated in the function returned from `server.definePost` and `server.defineGet`. These functions handle the details of how to connect to the server and send the HTTP request. In a real-world example, these could also encapsulate authorization and encryption details.

- The client and server here have a strongly-typed connection between them, without doing any type-casts.

- Infra components such as `ApiServer`, `Store`, and `onDeploy` have a dual implementation: they can either run in-process or set up the docker infrastructure to run themselves. The ability to run in-process makes debugging easier since you can just breakpoint anywhere in the code and step across component boundaries such as stepping from the client into the calls to the server.


### Explanation of Example

- The example script is run at build time. So functions like `createCustomerServer` and `createExampleClient` are run at build time and in turn run `new Store` and `onDeploy`, which register the relevant pieces that ultimately lead to the generation of the docker and docker-compose files.

- The example script is copied into each docker container, so it can be run again at runtime in each environment (in this case, the client and server environments).

- When running in each environment, the script takes on a different *persona*. In the client environment, the script behaves as the client. In the server environment, the script behaves as the server. For example, in the client environment, the on-deploy callback is called, but it the server environment, it is not, even though the callback is instantiated in both.

- The `id` function is used to generate a deterministic ID for each component -- an ID which is the same for each component at build time and in each runtime environment. This ID is used for all the wiring under the hood, such as the naming of environment variables, docker services, etc. IDs are also functions which can be called using tagged-template syntax to create child IDs, such as the `customer-server` child ID of the `my-app` root ID, and the `db` child ID of the `customer-server` ID. So the full ID of the database is `my-app.customer-server.db`. If the client also wanted a database, it might have it's own `db` ID, but the full ID would be `my-app.example-client.db` to distinguish it from the server.


# Concepts

## Startup and Runtime

Execution in this environment is split into two phases: startup and runtime. The startup phase is common to all personas, while the runtime phase is specific to each persona. The startup sequence is the same in every environment and will instantiate the component tree of the app. Then based on the current persona (e.g. client or server), the app will differentiate its behavior.

## Personas

The concept of a persona is a way of describing the environment in which the application is running. For example, the application might be running in a client environment, a server environment, or a build-time environment. The application can behave differently in each environment, but the same code is used in each environment. The running persona is typically determined by the environment variables that are set in the environment. For example, the `PERSONA` environment variable might be set to `my-app.example-client` or `my-app.customer-server.api`. The `PERSONA` environment variable is set by the `docker-compose.yml` file, which in turn is generated by the application script.

## Build-time execution

A built-in persona is the build-time persona (`buildPersona` in `build-time.ts`). Like the other personas, it executes the same startup sequence that instantiates the application tree, but it then specializes its behavior to perform build-time actions:

- Generating docker and docker-compose files based on the application tree.
- Reading and writing persistent build-time data stores for things like secrets.

## Relation to Microvium

The concept behind this library is based on the idea behind [Microvium snapshotting](https://github.com/coder-mike/microvium/blob/main/doc/concepts.md). Snapshotting in Microvium runs the application at compile time, and then a snapshot of that application is taken and stored in a binary format. The snapshot is then loaded at runtime and the application is resumed from the snapshot. The same snapshot can be distributed to multiple target environments, such as a server and a client, and they take with them the entire state of the application.

This library provides a weaker form of the Microvium idea. Rather than deploying a snapshot of the application, the application is re-run in each environment (e.g. client, server, and build-time). The identity of objects is preserved across environments by using the deterministic ID generator. The IDs of each component can be used to identify the same component in other environments, allowing components to behave in a cohesive, distributed manner.

This is weaker than the snapshotting paradigm used in Microvium for two reasons:

1. Microvium snapshots are guaranteed to be identical whereas applications based on this library are relying on the developer to make sure that the application tree is the same each time the startup phase is executed in each environment.

2. This library relies on always manually defining the IDs to associate components in each environment, whereas in Microvium, all objects have implicit identity, and non-deterministic processes like random number generation can be used to generate unique IDs, which propagate naturally with the snapshot. In this library, if you used a RNG at startup it would just generate different numbers in each environment.

## Limitations of approach

- It's manual work to keep the startup sequence the same in every environment, including ID generation.

- There is no compile-time mechanism to enforce that you call things at the right time. E.g. to stop you from calling `onDeploy` at runtime, or to indicate that you should only use `onDeploy` at build-time. This is mitigated a bit by calling `assertStartup`, `assertRuntime`, etc. at the start of each function, as a check but also as an indication to the reader of the intended location of the execution, but this is not enforced by the compiler.

## Limitations of POC

- The POC version of this library uses docker-compose as an IaC foundation, but this is not suitable for production purposes. A future version could use Terraform or some equivalent.

- There is no tear-down process implemented if a new deployment doesn't contain a persistent resource that a previous one did.

- "Secrets" such as port numbers and passwords are currently given to every container, even if the container doesn't need it. A future version could be more selective.

- Similarly, this POC assumes that everything is accessible to everything on the network, which is not suitable for a production environment. A future version could be more restrictive. This could be as simple as having a `dependsOn` clause in each service to declare the injected dependencies, and then this can be used to auto-generate the network restrictions and environment variables.

- Indexer functions in the Store are assumed to be immutable. If you change the implementation of an indexer function, you need to change the ID of the indexer (e.g. appending a version number to the ID).

- Postgres instances launched with docker-compose have their password configuration embedded into the volume after the first use, so if you change the password (or you delete the `passwords.json` file in the build output), you need to manually delete the volume.