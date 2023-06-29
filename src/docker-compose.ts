import yaml from 'js-yaml'
import { ID, idToSafeName, rootId } from "./id";
import { assertStartupTime } from './persona';
import { BuildTimeFile } from './build-time-file';
import path from 'path'
import { BuildTimeValue, BuildTimeValueOr } from './build-time';
import { Port } from './port';
import { secrets } from './secret';

new BuildTimeFile(rootId('docker-compose'), {
  ext: '.yml',
  content: new BuildTimeValue(() =>
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
            environment.push(`${key}=${BuildTimeValue.get(value)}`);
          }
        }

        for (const [key, value] of Object.entries(secrets)) {
          environment.push(`${key}=${BuildTimeValue.get(value)}`)
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
  )
});

interface ServiceInfo {
  dockerImage: string | BuildTimeFile;
  environment?: { [key: string]: BuildTimeValueOr<string> };
  volumeMounts?: Array<{
    volume: DockerVolume,
    mountPath: string,
  }>;
  ports?: Port[];
}

const volumes: Record<string, DockerVolume> = {}
const services: Record<string, ServiceInfo> = {}

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