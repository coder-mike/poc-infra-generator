import yaml from 'js-yaml'
import { ID, idToSafeName, rootId } from "./id";
import { Lazy, unexpected } from './utils';
import { assertNotStartup, assertStartupTime, currentPersona } from './persona';
import { BuildTimeFile } from './build-time-file';
import path from 'path'
import { BuildTimeValue } from './build-time';
import { Port } from './port';

new BuildTimeFile(rootId('docker-compose'), '.yml', () =>
  yaml.dump({
    version: '3',
    volumes: Object.fromEntries(Object.values(volumes).map(volume => [
      volume.name, null
    ])),
    services: Object.fromEntries(Object.entries(services).map(([serviceName, service]) => {
      const result: any = {};

      if (typeof service.dockerImage === 'string') {
        result.image = service.dockerImage;
      } else {
        result.build = {
          context: '..', // Relative to the project root
          dockerfile: path.relative(process.cwd(), service.dockerImage.filepath)
            .replace(/\\/g, '/') // Fix for Windows pathnames
        }
      }

      const environment: string[] = [];
      if (service.environment) {
        for (const [key, value] of Object.entries(service.environment)) {
          environment.push(`${key}=${value()}`);
        }
      }

      for (const [key, value] of Object.entries(secrets)) {
        environment.push(`${key}=${value()}`)
      }

      if (environment.length > 0) {
        result.environment = environment;
      }

      if (service.volumeMounts) {
        result.volumes = service.volumeMounts.map(mount => `${mount.volume.name}:${mount.mountPath}`);
      }

      if (service.ports) {
        // Note: the port mapping here assumes the same port in the container as outside
        result.ports = service.ports.map(port => `${port.get()}:${port.get()}`);
      }

      return [serviceName, result]
    })),
  }, { lineWidth: 1000, noCompatMode: true, styles: { '!!null': 'empty' } })
);

interface ServiceInfo {
  dockerImage: string | BuildTimeFile;
  environment?: { [key: string]: Lazy<string> };
  volumeMounts?: Array<{
    volume: DockerVolume,
    mountPath: string,
  }>;
  ports?: Port[];
}

const volumes: Record<string, DockerVolume> = {}
const services: Record<string, ServiceInfo> = {}
const secrets: Record<string, Lazy<string>> = {}

export class DockerVolume {
  public name: string;

  constructor (id: ID){
    if (volumes.hasOwnProperty(id.value)) {
      throw new Error(`Volume ${id.value} already defined`);
    }
    this.name = idToSafeName(id);
    volumes[id.value] = this;
  }
}

export class DockerService {
  public name: string;

  constructor (public id: ID, info: ServiceInfo) {
    assertStartupTime()
    this.name = idToSafeName(id);
    if (services.hasOwnProperty(this.name)) {
      throw new Error(`Service ${this.name} already defined (${id})`);
    }
    services[this.name] = info;
  }
}

export class Secret<T> implements BuildTimeValue<T> {
  private environmentVariableName: string;

  constructor (id: ID, private buildTimeValue: Lazy<T>) {
    this.environmentVariableName = idToSafeName(id);

    if (secrets.hasOwnProperty(this.environmentVariableName)) {
      throw new Error(`Secret ${this.environmentVariableName} already defined (${id})`);
    }

    secrets[this.environmentVariableName] = () => JSON.stringify(buildTimeValue());
  }

  get = (): T => {
    assertNotStartup();
    switch (currentPersona?.host) {
      case 'build': return this.buildTimeValue();
      case 'node': return JSON.parse(process.env[this.environmentVariableName] ?? unexpected());
      case 'browser': throw new Error(`Currently no way to route secrets to a browser environment`);
      case 'none': unexpected(); // It doesn't make sense that this code is executing in a non-executional environment
      default: throw new Error(`Unknown host ${currentPersona!.host}`);
    }
  }
}
