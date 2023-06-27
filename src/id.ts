// Represents a globally unique but human readable identifier, typically derived
// from a parent ID. Typically these IDs are used to name resources in the app,
// such as databases and services.
import crypto from "crypto";

export type ID = {
  /**
   * A string value that is unique for each logically-distinct ID. If you don't
   * care about any special characters, you can use this. Otherwise, consider
   * using `idToFilePath` or `idToFilename`
   */
  value: string;

  /**
   * Create a child ID based on the current ID. The child ID will be unique if
   * the current ID is unique and suffix is distinct among all other siblings.
   *
   * A shorthand for id.child('x') is id`x` (using it as a tagged template function).
   */
  child: (suffix: string) => ID;

  /**
   * The parts that make up the ID
   */
  parts: string[];
} & ((strings: TemplateStringsArray, ...values: any[]) => ID);

function createID(value: string): ID {
  // Create a function that can be used as a tagged template function
  let id: any = (strings: TemplateStringsArray, ...values: any[]) => {
    const suffix = strings.reduce((acc, str, i) => acc + str + (values[i] || ""), "");
    return child(suffix);
  };

  function child(suffix: string) {
    return createID(`${value}.${encodeIdPart(suffix)}`);
  }

  function toString() {
    return value;
  }

  id = Object.assign(id, { value, child, toString })

  // The parts property is represented as a getter
  Object.defineProperty(id, 'parts', {
    get: () => value.split(".").map(decodeIdPart)
  })

  return id;
}

export function rootId(name: string): ID {
  return createID(encodeIdPart(name))
}

export function idToFilePath(id: ID): string {
  return id.parts
    .map(s => s.replace(/[^a-zA-Z0-9.\- ]/g, (char) => `[${char.charCodeAt(0)}]`))
    .join("/");
}

export function idToFilename(id: ID): string {
  // Note: this function also escapes periods in each part, since periods are
  // used as the joining character.
  return id.parts
    .map(s => s.replace(/[^a-zA-Z0-9\- ]/g, (char) => `[${char.charCodeAt(0)}]`))
    .join('.');
}

export function idToUriPath(id: ID): string {
  return id.parts
    .map(encodeURIComponent)
    .join('/');
}

// Generates a 40-character name that has no special characters except
// underscore. It uses at least 8 characters for a hash and the remaining
// characters for a human-readable suffix which is derived from the end of the
// ID text.
export function idToSafeName(id: ID): string {
  const totalLength = 40;
  const minHashLength = 8;
  const maxHashLength = 16; // Limit for readability

  // Fit as many parts as we can, starting from the last one because the first
  // ones are assumed to be more general such as the app name.
  let nameStr = '';
  const parts = [...id.parts];
  let part = parts.pop();
  while (part && nameStr.length + part.length <= totalLength - minHashLength - 1) {
    nameStr = '_' + part.replace(/[^a-zA-Z0-9_]+/g, '_') + nameStr;
    part = parts.pop();
  }

  // The rest we can fill up with hash
  const hashLength = Math.min(totalLength - nameStr.length, maxHashLength);
  const hash = crypto.createHash('md5');
  hash.update(id.value, 'utf8');
  const hashStr = hash.digest('hex').substring(0, hashLength);

  return hashStr + nameStr;
}

function encodeIdPart(part: string): string {
  // Escape periods in the part to avoid naming clashes between
  // `id.child('foo').child('bar')` and `id.child('foo.bar')`. Also escapes
  // square brackets because these are used as special characters in the encoded
  // form.
  return part.replace(/[.\[\]]/g, (char) => `[${char.charCodeAt(0)}]`);
}

export function decodeIdPart(s: string): string {
  return s.replace(/\[(\d+)\]/g, (_, charCode) => String.fromCharCode(Number(charCode)));
}
