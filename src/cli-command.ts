import { BuildTimeFile } from "./build-time-file";
import { ID, rootId } from "./id";
import { Persona, assertStartupTime, runningInProcess } from "./persona";
import * as readline from 'readline';
import { parseArgsStringToArgv } from 'string-argv';
import path from 'path';
import assert from "assert";
import { BuildTimeValue, assertBuildTime } from "./build-time";
import { secrets } from "./secret";
import { gitIgnorePath } from "./build-git-ignore";
import { teardown } from "./teardown";

const cliCommands: Record<string, CliCommand> = {};
let cliPersona: Persona | undefined;

/**
 * Entry point for a CLI command.
 *
 * @param parsedArgs The arguments parsed into simple key-value form with
 * remaining being positional arguments. The expected format for the key-value
 * form is `--key=value` or `-key=value`. The form `--key` or `-key` on its own
 * parses to `key: true`.
 * @param rawArgs The raw arguments as passed to the CLI, not including the
 * command string itself or anything before it.
 */
type CliEntryPoint = (parsedArgs: ParsedArgs, rawArgs: string[]) => void | Promise<void>;

/**
 * Defines a CLI of the distributed application.
 */
export class CliCommand {
  constructor(
    public id: ID,
    public command: string,
    public entryPoint: CliEntryPoint
  ) {
    assertStartupTime();
    registerCliCommand(this);
    createRuntimeWrapper(id, this);
  }
}

new BuildTimeFile(rootId('cli-dot-env'), {
  content: new BuildTimeValue(getDotEnvFileContent),
  filepath: 'bin/.env'
});
// Git-ignore everything in the bin directory
new BuildTimeFile(rootId('cli-gitignore'), {
  content: `*`,
  filepath: 'bin/.gitignore'
});

function getDotEnvFileContent() {
  assertBuildTime();
  let envContent = '';

  for (const [key, secret] of Object.entries(secrets)) {
    const value = secret.get();

    // JSON encode the value
    let jsonValue = JSON.stringify(value);

    // Escape percent signs for Windows batch files
    jsonValue = jsonValue.replace(/%/g, '%%');

    // Escape exclamation marks for Windows batch files (delayed expansion)
    jsonValue = jsonValue.replace(/!/g, '^!');

    // Escape newlines for multi-line values
    jsonValue = jsonValue.replace(/\n/g, '\\n');

    // Add to .env content
    envContent += `${key}=${jsonValue}\n`;
  }
  return envContent;
}


function registerCliCommand(cliCommand: CliCommand) {
  assertStartupTime();
  if (!cliPersona) {
    // Create a new persona to execute CLI commands (only create once)
    cliPersona = new Persona(rootId('cli'), 'cli', runCli);
  }

  if (cliCommands[cliCommand.command]) {
    throw new Error(`CLI command ${cliCommand.command} already registered`);
  }

  cliCommands[cliCommand.command] = cliCommand;
}

async function runCli() {
  const command = process.argv[2];
  if (!command) {
    await runInteractiveTerminal().catch(console.error);
  } else if (cliCommands[command]) {
    const rawArgs = process.argv.slice(3);
    const parsedArgs = parseCliArgs(rawArgs);
    await cliCommands[command].entryPoint(parsedArgs, rawArgs);
    await teardown();
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(`Available commands: ${Object.keys(cliCommands).join(', ')}`);
    process.exit(1);
  }
}

async function runInteractiveTerminal() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('Running in interactive mode.');

  const queryUser = async () => {
    const prompt = `Please enter a command: (options are ${
      Object.keys(cliCommands).join(', ')
    })\n> `;

    rl.question(prompt, async (input) => {
      // Parse the input string into command and arguments
      const [command, ...args] = parseArgsStringToArgv(input);

      // Check if the command exists in cliCommands
      if (cliCommands.hasOwnProperty(command)) {
        const parsedArgs = parseCliArgs(args);
        try {
          // Await the entryPoint in case it's asynchronous
          await cliCommands[command].entryPoint(parsedArgs, args);
        } catch (e) {
          console.error(e);
        }
      } else {
        console.log(`Invalid command: ${command}`);
        listCommands();
      }

      // Query the user again
      await queryUser();
    });
  };

  rl.on('SIGINT', () => {
    console.log('\nExiting...');
    rl.close();
  });

  // Start querying the user
  await queryUser();
}

function listCommands() {
  console.log('Available commands:');
  for (let command in cliCommands) {
    console.log(`- ${command}`);
  }
}

export type ParsedArgs = {
  named: Record<string, any>,
  positional: string[],
};

function parseCliArgs(args: string[]): ParsedArgs {
  const named: Record<string, string | true> = {};
  const positional: string[] = [];

  // Loop through all arguments passed
  for (const arg of args) {

    // Match arguments of the form '-arg=X' or '--arg=X'
    const namedArgWithEqualsMatch = arg.match(/^--?([^=]+)=(.*)$/);

    if (namedArgWithEqualsMatch) {
      const [, key, value] = namedArgWithEqualsMatch;
      named[key] = value;
      continue;
    }

    // Match arguments of the form '-arg' or '--arg'
    const namedArgMatch = arg.match(/^--?.+$/);

    if (namedArgMatch) {
      const key = arg.slice(arg.startsWith("--") ? 2 : 1);
      named[key] = true;
      continue;
    }

    // Everything else is considered a positional argument
    positional.push(arg);
  }

  return { named, positional };
}

function createRuntimeWrapper(id: ID, command: CliCommand) {
  let entryScript = require.main && path.resolve(require.main.path, require.main.filename);
  if (!entryScript) {
    throw new Error('Could not determine app entry script');
  }

  // Entry script relative to the bin directory
  entryScript = path.relative(path.join(process.cwd(), 'bin'), entryScript)

  const persona = new Persona(id, 'cli-command', async () => {
    // Note: only slicing 2, rather than 3, because the command argument isn't
    // here.
    const rawArgs = process.argv.slice(2);
    const parsedArgs = parseCliArgs(rawArgs);
    await command.entryPoint(parsedArgs, rawArgs);
    await teardown();
  });

  let runner: string;
  // Running under ts-node
  if (path.extname(entryScript) === '.ts') {
    runner = 'npx ts-node'
  }
  // Running under node
  else {
    assert(path.extname(entryScript) === '.js' || path.extname(entryScript) === '.mjs');
    runner = 'node';
  }

  new BuildTimeFile(id`win`, {
    filepath: `bin/${command.command}.bat`,
    content: `@echo off\nsetlocal\nset PERSONA=${
      persona.environmentVariableValue
    }\n\nREM Load environment variables from .env file\nfor /f "usebackq tokens=*" %%a in (\`%~dp0\.env\`) do set %%a\n\nREM Run the node script\ncall ${
      runner
    } "%~dp0${
      entryScript.replace(/\//g, '\\')
    }" %*`
  });

  new BuildTimeFile(id`nix`, {
    filepath: `bin/${command.command}`,
    content: `#!/bin/bash\n\nexport PERSONA=${
      persona.environmentVariableValue
    }\n\n# Load environment variables from .env file\nset -a\nsource "$(dirname "$0")/.env"\nset +a\n\n# Run the node script\n${
      runner
    } "$(dirname "$0")/${
      entryScript
    }" "$@"`
  });
}