import { CliCommand } from './cli-command';
import { rootId, Store, ApiServer, ID, runPersona, onDeploy } from './index';

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

temp_experiments();

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



// ----------------------- Experiments ---------------------

function temp_experiments() {
  new CliCommand(id`add`, 'add', async (args) => {
    const [a, b] = args.positional;
    console.log(`${a} + ${b} = ${a + b}`);
  });
}