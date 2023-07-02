import { strict as assert } from 'assert';
import { CliCommand } from './cli-command';
import { rootId, Store, ApiServer, ID, run, Worker } from './index';

declare global {
  interface ArrayConstructor {
    fromAsync<T>(iterable: AsyncIterable<T>): Promise<T[]>;
  }
}

Array.fromAsync ??= async function <T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const arr: T[] = [];
  for await (const item of iterable) arr.push(item);
  return arr;
}

const id = rootId('my-app');

interface Message {
  text: string;
  from: string;
  to: string[];
}

const store = new Store<Message>(id`store`);

// Sample where each value yields a single index entry
const fromIndex = new store.Index(id`from.v1`, (value) => [{
  indexKey: value.from,
  inlineValue: { to: value.to }
}]);

// Sample where each value may yield multiple index entries
const toIndex = new store.Index(id`to.v1`, (value) => value.to.map(to => ({
  indexKey: to,
  inlineValue: { from: value.from }
})));

// // Some example messages
// await store.set('1', { from: 'Alice', to: ['Bob'], text: 'Hello' })
// await store.set('2', { from: 'Alice', to: ['Bob', 'Charlie'], text: 'World' })

// // Who did alice send messages to?
// console.log('Alice sent messages to',
//   (await fromIndex.get('Alice'))
//     .map(entry => entry.inlineValue!.to))

// // Who did Bob receive messages from?
// console.log('Bob received messages from',
//   (await toIndex.get('Alice'))
//     .map(entry => entry.inlineValue!.from))

// // Which messages are from Alice?
// console.log('Messages from Alice',
//   (await fromIndex.get('Alice', { retrieveValues: true }))
//     .map(entry => entry.value!.text))

// new CliCommand(id`get`, 'get', async (args) => {
//   const key = args.positional[0];
//   const value = await store.get(key);
//   console.log(`get ${key}:`, value);
// });

// new CliCommand(id`set`, 'set', async (args) => {
//   const [key, text, from, to] = args.positional;
//   const message = { text, from, to };
//   await store.set(key, message);
//   console.log(`set ${key}:`, message);
// });

// // Get all messages from a given sender
// new CliCommand(id`from`, 'from', async (args) => {
//   const [from] = args.positional;
//   for (const { key, inlineValue } of await fromIndex.get(from)) {
//     console.log(`- ${key}`, inlineValue);
//   }
// });

// // Get all messages to a given receiver
// new CliCommand(id`to`, 'to', async (args) => {
//   const [to] = args.positional;
//   for (const { key, inlineValue } of await toIndex.get(to)) {
//     console.log(`- ${key}`, inlineValue);
//   }
// });

// Get all messages to a given receiver
new CliCommand(id`all`, 'all', async (args) => {
  await testIndexers(store)
});

// Run the persona defined by the current file
run();

async function testStore(store: Store<any>) {
  // Wipe the store, in case there are outstanding keys from previous requests
  for await (const key of store.allKeys()) {
    await store.del(key);
  }

  console.log('Starting store tests...');

  // Testing store.set and store.get
  console.log('Testing store.set and store.get...');
  await store.set('key1', { name: 'Alice', age: 30 });
  let retrievedValue = await store.get('key1');
  assert.deepEqual(retrievedValue, { name: 'Alice', age: 30 }, 'Failed to set or get value');

  // Testing store.modify
  console.log('Testing store.modify...');
  let modifiedValue = await store.modify('key1', value => ({...value, age: 31}));
  assert.deepEqual(modifiedValue, { name: 'Alice', age: 31 }, 'Failed to modify value');

  // Testing store.has
  console.log('Testing store.has...');
  let exists = await store.has('key1');
  assert(exists, 'Failed to detect key');

  // Testing store.del
  console.log('Testing store.del...');
  await store.del('key1');
  retrievedValue = await store.get('key1');
  assert.equal(retrievedValue, undefined, 'Failed to delete value');

  // Test modifying non-existent key
  console.log('Testing modifying non-existent key...');
  modifiedValue = await store.modify('key1', value => ({name: 'Bob', age: 32}));
  assert.deepEqual(modifiedValue, { name: 'Bob', age: 32 }, 'Failed to modify non-existent key');

  // Enumerating keys
  console.log('Enumerating keys...');
  await store.set('key2', {name: 'Eve', age: 25});
  let keys = [];
  for await (const key of store.allKeys()) {
      keys.push(key);
  }
  assert.deepEqual(keys, ['key1', 'key2'], 'Failed to enumerate keys');

  // Testing store with undefined value (deletion)
  console.log('Testing store with undefined value (deletion)...');
  await store.set('key1', undefined);
  retrievedValue = await store.get('key1');
  assert.equal(retrievedValue, undefined, 'Failed to delete value by setting undefined');

  console.log('All tests passed');
}

export async function testIndexers(store: Store<Message>) {
  console.log('Starting indexers tests...');

  // Wipe the store, in case there are outstanding keys from previous requests
  for await (const key of store.allKeys()) {
    await store.del(key);
  }

  // Setting values in the store
  await store.set('1', { from: 'Alice', to: ['Bob'], text: 'Hello' });
  await store.set('2', { from: 'Alice', to: ['Charlie', 'Dave'], text: 'World' });
  await store.set('3', { from: 'Charlie', to: ['Bob', 'Alice'], text: '!' });

  // What messages are from Alice?
  console.log('Testing fromIndex...');
  let fromAlice = await fromIndex.get('Alice');
  assert.deepEqual(fromAlice, [{
    key: '1',
    inlineValue: { to: ['Bob'] },
  }, {
    key: '2',
    inlineValue: { to: ['Charlie', 'Dave'] },
  }]);

  // What messages are to Bob?
  console.log('Testing toIndex...');
  let toBob = await toIndex.get('Bob');
  assert.deepEqual(toBob, [{
    key: '1',
    inlineValue: { from: 'Alice' },
  }, {
    key: '3',
    inlineValue: { from: 'Charlie' },
  }]);

  // What messages are from Charlie? (with values)
  console.log('Testing retrieval of values along with index...');
  let fromCharlieWithValues = await fromIndex.get('Charlie', { retrieveValues: true });
  assert.deepEqual(fromCharlieWithValues, [{
    key: '3',
    inlineValue: { to: ['Bob', 'Alice'] },
    value: { from: 'Charlie', to: ['Bob', 'Alice'], text: '!' },
  }]);

  console.log('All indexer tests passed');
}