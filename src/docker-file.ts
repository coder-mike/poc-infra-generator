import { assertBuildTime } from "./build-time";
import { BuildTimeFile } from "./build-time-file";
import { ID } from "./id";
import { assertNever } from "./utils";

export class DockerFile extends BuildTimeFile {
  constructor (id: ID, public instructions: DockerInstruction[]) {
    super(id, '', () => generateDockerfile(instructions));
  }
}

export type KeyValuePair = {
  key: string;
  value: string;
};

export type HealthcheckInstruction = {
  test: string;
  interval?: string;
  timeout?: string;
  startPeriod?: string;
  retries?: number;
};

export interface FromInstruction {
  op: 'FROM';
  image: string;
  tag?: string;
  alias?: string;
}

export interface RunInstruction {
  op: 'RUN';
  commands: string[];
}

export interface CmdInstruction {
  op: 'CMD';
  command: string;
  params?: string[];
}

export interface LabelInstruction {
  op: 'LABEL';
  labels: KeyValuePair[];
}

export interface ExposeInstruction {
  op: 'EXPOSE';
  ports: number[];
}

export interface EnvInstruction {
  op: 'ENV'
  variables: KeyValuePair[];
}

export interface AddCopyInstruction {
  op: 'ADD' | 'COPY';
  src: string;
  dest: string;
}

export interface EntryInstruction {
  op: 'ENTRYPOINT';
  executable: string;
  params?: string[];
}

export interface VolumeInstruction {
  op: 'VOLUME';
  paths: string[];
}

export interface UserInstruction {
  op: 'USER';
  user: string;
}

export interface WorkDirInstruction {
  op: 'WORKDIR';
  path: string;
}

export interface ArgInstruction {
  op: 'ARG'
  args: KeyValuePair[];
}

export interface OnBuildInstruction {
  op: 'ONBUILD';
  trigger: string;
}

export interface StopSignalInstruction {
  op: 'STOPSIGNAL';
  signal: string;
}

export interface HealthCheckInstructionWrapper {
  op: 'HEALTHCHECK';
  healthcheck: HealthcheckInstruction;
}

export interface ShellInstruction {
  op: 'SHELL';
  commands: string[];
}

export type DockerInstruction =
  | FromInstruction
  | RunInstruction
  | CmdInstruction
  | LabelInstruction
  | ExposeInstruction
  | EnvInstruction
  | AddCopyInstruction
  | EntryInstruction
  | VolumeInstruction
  | UserInstruction
  | WorkDirInstruction
  | ArgInstruction
  | OnBuildInstruction
  | StopSignalInstruction
  | HealthCheckInstructionWrapper
  | ShellInstruction;

type DockerfileInstructions = DockerInstruction[];

function generateDockerfile(dockerfile: DockerfileInstructions): string {
  let output = '';

  for (const instruction of dockerfile) {
    switch (instruction.op) {
      case 'FROM':
        output += `FROM ${instruction.image}${instruction.tag ? `:${instruction.tag}` : ''}${instruction.alias ? ` AS ${instruction.alias}` : ''}\n`;
        break;
      case 'RUN':
        output += `RUN ${instruction.commands.join(' && ')}\n`;
        break;
      case 'CMD':
        output += `CMD [${instruction.params ? `"${instruction.command}", ${instruction.params.map(param => `"${param}"`).join(', ')}` : `"${instruction.command}"`}]\n`;
        break;
      case 'LABEL':
        const labels = instruction.labels.map(label => `"${label.key}"="${label.value}"`).join(' ');
        output += `LABEL ${labels}\n`;
        break;
      case 'EXPOSE':
        output += `EXPOSE ${instruction.ports.join(' ')}\n`;
        break;
      case 'ENV':
        const envs = instruction.variables.map(variable => `${variable.key}=${variable.value}`).join(' ');
        output += `ENV ${envs}\n`;
        break;
      case 'ADD':
      case 'COPY':
        output += `${instruction.op} ${instruction.src} ${instruction.dest}\n`;
        break;
      case 'ENTRYPOINT':
        output += `ENTRYPOINT [${instruction.params ? `"${instruction.executable}", ${instruction.params.map(param => `"${param}"`).join(', ')}` : `"${instruction.executable}"`}]\n`;
        break;
      case 'VOLUME':
        output += `VOLUME ${JSON.stringify(instruction.paths)}\n`;
        break;
      case 'USER':
        output += `USER ${instruction.user}\n`;
        break;
      case 'WORKDIR':
        output += `WORKDIR ${instruction.path}\n`;
        break;
      case 'ARG':
        const args = instruction.args.map(arg => `${arg.key}=${arg.value}`).join(' ');
        output += `ARG ${args}\n`;
        break;
      case 'ONBUILD':
        output += `ONBUILD ${instruction.trigger}\n`;
        break;
      case 'STOPSIGNAL':
        output += `STOPSIGNAL ${instruction.signal}\n`;
        break;
      case 'HEALTHCHECK':
        const healthcheck = instruction.healthcheck;
        const hcFlags = [
          healthcheck.interval ? `--interval=${healthcheck.interval}` : '',
          healthcheck.timeout ? `--timeout=${healthcheck.timeout}` : '',
          healthcheck.startPeriod ? `--start-period=${healthcheck.startPeriod}` : '',
          healthcheck.retries ? `--retries=${healthcheck.retries}` : ''
        ].filter(flag => flag).join(' ');
        output += `HEALTHCHECK ${hcFlags} CMD ${healthcheck.test}\n`;
        break;
      case 'SHELL':
        output += `SHELL [${instruction.commands.map(command => `"${command}"`).join(', ')}]\n`;
        break;
      default:
        assertNever(instruction);
    }
  }

  return output;
}
