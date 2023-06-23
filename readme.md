# POC Infra

Author: Michael Hunter

Everything in this folder is developed in my own time and is not essential to the POC. It is MIT licensed and free to use in this project without restriction.

## Concept

The concept behind this library is based on the idea behind [Microvium snapshotting](https://github.com/coder-mike/microvium/blob/main/doc/concepts.md). Snapshotting in Microvium runs the application at compile time, and then a snapshot of that application is taken and stored in a binary format. The snapshot is then loaded at runtime and the application is resumed from the snapshot. The same snapshot can be distributed to multiple target environments, such as a server and a client, and they take with them the entire state of the application.

This allows a single component within the application to have both a client and server presence, for example. It also allows both the client and server to have some compile-time effect, such as generating IaC code. The end result is that a distributed application can be developed in a much more modular way.

This library provides a weaker form of this idea. Rather than deploying a snapshot of the application, the application is re-run in each environment (e.g. client, server, and build-time). The identity of objects is preserved across environments by using a deterministic ID generator (see [id.ts](./id.ts)). The IDs of each component can be used to identify the same component in other environments, allowing components to behave in a cohesive, distributed manner.

