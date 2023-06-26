import yaml from 'js-yaml'
import { ID, idToSafeName, rootId } from "./id";
import { Lazy, unexpected } from './utils';
import { assertNotStartup, assertStartupTime, currentPersona } from './persona';
import { BuildTimeFile } from './build-time-file';

new BuildTimeFile(rootId('docker-compose.yml'), () =>
  yaml.dump({
    version: '3',
    volumes: Object.values(volumes).map(volume => ({
      [volume.name]: null,
    })),
    services: Object.values(services).map(service => {
      const environment: string[] = [];
      if (service.environment) {
        for (const [key, value] of Object.entries(service.environment)) {
          environment.push(`${key}=${value()}`);
        }
      }

      for (const [key, value] of Object.entries(secrets)) {
        environment.push(`${key}=${value()}`)
      }

      return {
        image: typeof service.dockerImage === 'string'
          ? service.dockerImage
          : service.dockerImage.filepath,
        environment,
        volumes: service.volumeMounts?.map(mount => `${mount.volume.name}:${mount.mountPath}`),
      }
    }),
  })
);

interface ServiceInfo {
  dockerImage: string | BuildTimeFile;
  environment?: { [key: string]: Lazy<string> };
  volumeMounts?: Array<{
    volume: DockerVolume,
    mountPath: string,
  }>;
}

const volumes: Record<string, DockerVolume> = Object.create(null)
const services: Record<string, ServiceInfo> = Object.create(null)
const secrets: Record<string, Lazy<string>> = Object.create(null)

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
    if (services.hasOwnProperty(id.value)) {
      throw new Error(`Service ${id.value} already defined`);
    }
    this.name = idToSafeName(id);
    services[id.value] = info;
  }
}

export class Secret<T> {
  private environmentVariableName: string;

  constructor (id: ID, private buildTimeValue: Lazy<T>) {
    this.environmentVariableName = idToSafeName(id);

    if (secrets.hasOwnProperty(this.environmentVariableName)) {
      throw new Error(`Secret ${id.value} already defined`);
    }

    secrets[this.environmentVariableName] = () => JSON.stringify(buildTimeValue());
  }

  get(): T {
    assertNotStartup();
    switch (currentPersona!.host) {
      case 'build': return this.buildTimeValue();
      case 'node': return JSON.parse(process.env[this.environmentVariableName] ?? unexpected());
      case 'browser': throw new Error(`Currently no way to route secrets to a browser environment`);
      case 'none': unexpected(); // It doesn't make sense that this code is executing in a non-executional environment
      default: throw new Error(`Unknown host ${currentPersona!.host}`);
    }
  }
}
