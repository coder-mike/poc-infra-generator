# Proof of concept: Infra Generator

Author: Michael Hunter
License: MIT

This library is not production-ready. It is a proof of concept for a more modular way of developing distributed applications. It generates docker files and docker-compose files for you according to the resources you specify in the application. The docker-compose file is meant to be representative of some other hypothetical production-ready IaC output that would be used in a real version of this library.

As of this writing, this library is a work in progress (WIP). It is not yet usable even as a proof of concept.

## Prerequisites

Install docker and docker-compose.

## Install

Because this is a POC, I haven't published this to NPM. To use it, clone the repo into `libs/@coder-mike/poc-infra-generator` under your project and run `npm install` and `npm run build` (in the cloned directory).

## Example Usage

The following is an example that creates an Express API server called the "customer-server" backed by a postgres database containing a table of customers, and an example client application that sends a record to the database through the API and reads it back again.

The following is aspirational, since the library is a WIP:

```ts
import { rootId, Store, ApiServer, ID, runPersona,  } from 'libs/@coder-mike/poc-infra-generator';

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
# Build the example. This also generates the docker files and docker-compose file
npm run build-example
cd build
# Run the whole distributed system (client, server, and database)
docker-compose up
```

Or to run the whole example in-process instead of using docker:

```sh
# Build the example. This also generates docker files but we won't use them
npm run build-example
# Run everything in-process and in-memory. This is useful for debugging.
npm run start-example-in-process
```

### Advantages demonstrated in this example

There are a few key points to highlight in this example before I explain it:

- This example is a single script (representative of a single application) but contains code that executes in 3 different places: the client, the server, and build-time configuration of the infra.

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
- There is no compile-time mechanism to enforce that you call things at the right time. E.g. to stop you from calling `onDeploy` at runtime.

## Limitations of POC

- There is no tear-down process implemented if a new deployment doesn't contain a persistent resource that a previous one did.
