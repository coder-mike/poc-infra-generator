import { CliCommand } from './cli-command';
import { rootId, Store, ApiServer, ID, run, onDeploy } from './index';

const id = rootId('my-app');

const store = new Store<{ message: string }>(id`store`);

new CliCommand(id`get`, 'get', async (args) => {
  const key = args.positional[0];
  const value = await store.get(key);
  console.log(`get ${key}: ${value?.message}`);
});

new CliCommand(id`set`, 'set', async (args) => {
  const key = args.positional[0];
  const message = args.positional[1];
  await store.set(key, { message });
  console.log(`set ${key}: ${message}`);
});

// Run the persona defined by the current file
run();

