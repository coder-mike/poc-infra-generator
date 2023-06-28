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
 * remaining being positional arguments.
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
  options: Record<string, string[]>,
  positional: string[],
};

function parseCliArgs(args: string[]): ParsedArgs {
  const options: Record<string, string[]> = {};
  const positional: string[] = [];

  // Regular expression to match -arg=value or --arg=value
  const optionPattern = /^-{1,2}([^=]+)=(.+)$/;

  for (let arg of args) {
    const match = optionPattern.exec(arg);

    // If argument matches -arg=value or --arg=value
    if (match) {
      const key = match[1];
      const value = match[2];

      // If key already exists, append to the array, otherwise create a new array
      if (options[key]) {
        options[key].push(value);
      } else {
        options[key] = [value];
      }
    } else {
      // Consider it as positional argument
      positional.push(arg);
    }
  }

  return { options, positional };
}