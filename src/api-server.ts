import { ID, idToUriPath } from "./id";
import { Worker } from "./worker";
import { assertStartupTime, currentPersona, runningInProcess } from "./persona";
import express, { Request, Response, NextFunction } from 'express';
import { json } from 'body-parser';
import axios, { AxiosResponse } from 'axios';
import { Port } from "./port";

export type HttpEndpointHandler<T, U> = (payload: T) => Promise<U>;

export interface EndpointOpts {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'; // Default: POST
}

interface EndpointInfo {
  route: string;
  handler: HttpEndpointHandler<any, any>;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

/**
 * An HTTP server that exposes an API
 */
export class ApiServer {
  private port: Port;
  private host: string = 'localhost';
  private endpoints: EndpointInfo[] = [];

  constructor(id: ID) {
    assertStartupTime();
    this.port = new Port(id`port`);
    if (!runningInProcess) {
      const service = new Worker(id, () => setupExpressServer(this.endpoints, this.port),
        { ports: [this.port] })
      // docker-compose sets up a network where the service names are the hostnames.
      this.host = service.name;
    }
  }

  defineEndpoint<T, U>(route: string | ID, handler: HttpEndpointHandler<T, U>, opts?: EndpointOpts): HttpEndpointHandler<T, U> {
    if (runningInProcess) {
      // If running in-process, the client can call the server endpoint
      // directly.
      return handler;
    } else {
      // If running in a separate process, the client will call the server
      // endpoint via HTTP. This will be set up on startup in the docker
      // container.

      route = typeof route === 'string' ? route : idToUriPath(route);
      const method = opts?.method ?? 'POST';
      const endpointInfo: EndpointInfo = { route, handler, method };
      this.endpoints.push(endpointInfo);
      return clientWrapper(endpointInfo, this.host, this.port);
    }
  }
}

function setupExpressServer(endpoints: EndpointInfo[], port: Port) {
  // Creating an Express app
  const app = express();

  // Middleware for parsing JSON bodies
  app.use(json());

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    res.status(500);
    res.json({ error: err.message });
  });

  // Register all endpoints
  for (const endpoint of endpoints) {
    let method: (route: string, handler: (req: Request, res: Response, next: NextFunction) => void) => void;
    switch (endpoint.method) {
      case 'GET': method = app.get; break;
      case 'POST': method = app.post; break;
      case 'PUT': method = app.put; break;
      case 'DELETE': method = app.delete; break;
      default: throw new Error(`Unknown HTTP verb: ${endpoint.method}`);
    }

    method.call(app, endpoint.route, async (req, res, next) => {
      try {
        const result = await endpoint.handler(req.body);
        res.json(result || {});
      } catch (error) {
        next(error);
      }
    });
  }

  // Start the server
  app.listen(port.get(), () => {
      console.log(`Server listening at http://localhost:${port}`);
  });
}

function clientWrapper({ route, method: verb }: EndpointInfo, host: string, port: Port): HttpEndpointHandler<any, any> {
  if (route[0] !== '/') {
    throw new Error(`Route must start with '/': ${route}`);
  }
  return async (payload: any) => {
    // The CLIs are run outside the docker container network, so they need to
    // use localhost. The docker container network uses the service name as the
    // hostname (running in docker-compose).
    const hostName = (currentPersona?.host === 'cli-command') ? 'localhost' : host;
    const url = `http://${hostName}:${port.get()}${route}`;
    const response = await axios.request({
      url,
      method: verb,
      data: payload,
    });
    return response.data;
  }
}