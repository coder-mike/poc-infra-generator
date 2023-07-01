import { CliCommand } from './cli-command';
import { rootId, Store, ApiServer, ID, run, onDeploy } from './index';

const id = rootId('my-app');

interface Message {
  text: string;
  from: string;
  to: string;
}

const store = new Store<Message>(id`store`);

const fromIndex = new store.Index(id`from`, (value) => [{
  indexKey: value.from
}]);

const toIndex = new store.Index(id`to`, (value) => [{
  indexKey: value.to,
  // Snippet of the message text
  inlineValue: value.text.slice(0, 5) + '...'
}]);

new CliCommand(id`get`, 'get', async (args) => {
  const key = args.positional[0];
  const value = await store.get(key);
  console.log(`get ${key}:`, value);
});

new CliCommand(id`set`, 'set', async (args) => {
  const [key, text, from, to] = args.positional;
  const message = { text, from, to };
  await store.set(key, message);
  console.log(`set ${key}:`, message);
});

// Get all messages from a given sender
new CliCommand(id`from`, 'from', async (args) => {
  const [from] = args.positional;
  for (const { key, inlineValue } of await fromIndex.get(from)) {
    console.log(`- ${key}`, inlineValue);
  }
});

// Get all messages to a given receiver
new CliCommand(id`to`, 'to', async (args) => {
  const [to] = args.positional;
  for (const { key, inlineValue } of await toIndex.get(to)) {
    console.log(`- ${key}`, inlineValue);
  }
});

// Run the persona defined by the current file
run();

