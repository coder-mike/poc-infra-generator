import { ID, rootId } from "./id";
import { Persona, assertStartupTime } from "./persona";
import * as readline from 'readline';
import { parseArgsStringToArgv } from 'string-argv';

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
type CliEntryPoint = (parsedArgs: ParsedArgs, rawArgs: string[]) => void;

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
  }
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
    runInteractiveTerminal();
  } else if (cliCommands[command]) {
    const rawArgs = process.argv.slice(3);
    const parsedArgs = parseCliArgs(rawArgs);
    cliCommands[command].entryPoint(parsedArgs, rawArgs);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(`Available commands: ${Object.keys(cliCommands).join(', ')}`);
    process.exit(1);
  }
}

function runInteractiveTerminal() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('No command provided. Running in interactive mode.')

  const queryUser = () => {
    rl.question('Please enter a command:\n> ', (input) => {
      // Parse the input string into command and arguments
      const [command, ...args] = parseArgsStringToArgv(input);

      // Check if the command exists in cliCommands
      if (cliCommands.hasOwnProperty(command)) {
        const parsedArgs = parseCliArgs(args);
        cliCommands[command].entryPoint(parsedArgs, args);
      } else {
        console.log(`Invalid command: ${command}`);
        listCommands();
      }

      // Query the user again
      queryUser();
    });
  };

  rl.on('SIGINT', () => {
    console.log('\nExiting...');
    rl.close();
  });

  // Start querying the user
  queryUser();
}

function listCommands() {
  console.log('Available commands:');
  for (let command in cliCommands) {
    console.log(`- ${command}`);
  }
}

export type ParsedArgs = {
  named: Record<string, string | true>,
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