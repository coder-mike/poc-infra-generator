import { ID } from "./id";

export type TestFunctionRun = () => void;
export type TestFunctionStartup = (id: ID) => TestFunctionRun;

export function registerTestFunction(name: string, fn: TestFunctionStartup) {
  // TODO
}