import yaml from 'js-yaml'
import { defineFile, onBuild } from "./build-time";
import { ID, idToSafeName, rootId } from "./id";
import fs from 'fs'
import { Lazy, unexpected } from './utils';
import { assertNotStartup, currentPersona } from './persona';

const dockerComposeFile = defineFile(rootId('docker-compose.yml'));

export interface DockerVolume {
  name: string;
}

export interface DockerService {
  name: string;
}

interface ServiceInfo {
  dockerImage: string;
  environment: { [key: string]: Lazy<string> };
  volumeMounts: Array<{
    volume: DockerVolume,
    mountPath: string,
  }>
}

interface Secret<T> {
  get: () => T;
}

const volumes: Record<string, DockerVolume> = Object.create(null)
const services: Record<string, ServiceInfo> = Object.create(null)
const secrets: Record<string, Lazy<string>> = Object.create(null)

export function defineDockerVolume(id: ID): DockerVolume {
  if (volumes.hasOwnProperty(id.value)) {
    throw new Error(`Volume ${id.value} already defined`);
  }
  const name = idToSafeName(id);
  const volume: DockerVolume = { name };
  volumes[id.value] = volume;

  return volume;
}

export function defineDockerService(id: ID, info: ServiceInfo): DockerService {
  if (services.hasOwnProperty(id.value)) {
    throw new Error(`Service ${id.value} already defined`);
  }
  const name = idToSafeName(id);
  services[id.value] = info;
  return { name }
}

export function defineSecret<T>(id: ID, buildTimeValue: Lazy<T>): Secret<T> {
  const environmentVariableName = idToSafeName(id);

  if (secrets.hasOwnProperty(environmentVariableName)) {
    throw new Error(`Secret ${id.value} already defined`);
  }

  secrets[environmentVariableName] = () => JSON.stringify(buildTimeValue());

  return {
    get: () => {
      assertNotStartup();
      switch (currentPersona.host) {
        case 'build': return buildTimeValue();
        case 'node': return JSON.parse(process.env[environmentVariableName] ?? unexpected());
        case 'browser': throw new Error(`Currently no way to route secrets to a browser environment`);
        case 'none': unexpected(); // It doesn't make sense that this code is executing in a non-executional environment
        default: throw new Error(`Unknown host ${currentPersona.host}`);
      }
    }
  }
}

onBuild(() => {
  const yamlStr = yaml.dump({
    version: '3',
    volumes: Object.values(volumes).map(volume => ({
      [volume.name]: null,
    })),
    services: Object.values(services).map(service => ({
      image: service.dockerImage,
      environment: [
        ...Object.entries(service.environment).map(([key, value]) => `${key}=${value()}`),
        ...Object.entries(secrets).map(([key, value]) => `${key}=${value()}`),
      ],
      volumes: service.volumeMounts.map(mount => `${mount.volume.name}:${mount.mountPath}`),
    })),
  })
  fs.writeFileSync(dockerComposeFile.getFilename(), yamlStr);
});