import crypto from 'crypto';

export function notImplemented(feature?: string): never {
  throw new Error(`Not implemented${feature ? `: ${feature}` : ""}`);
}

export function unexpected(): never {
  throw new Error(`Code path not expected`);
}

export function sha256(input: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    return hash.digest('hex');
}

export type Lazy<T> = () => T;

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`);
}