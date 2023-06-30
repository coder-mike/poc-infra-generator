
const handlers: (() => void | Promise<void>)[] = [];

export async function teardown() {
  await Promise.all(handlers.map(handler => Promise.resolve(handler()).catch(console.error)))
}

export function registerTeardownHandler(handler: () => void | Promise<void>) {
  handlers.push(handler);
}