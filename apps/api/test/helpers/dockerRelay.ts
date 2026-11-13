import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/*
  Testcontainers talks to the Docker engine over a unix socket (or TCP). On WSL2 with Docker Desktop
  but without its "WSL integration", the `docker` on PATH is a wrapper around docker.exe and there
  is no /var/run/docker.sock: the engine is only reachable through a Windows named pipe.

  `docker system dial-stdio` is the CLI's own bridge to the daemon, so this listens on a unix socket
  and pipes every connection through one. It starts only when DOCKER_HOST is unset and no local
  socket exists, so CI and a normal Linux/Mac machine never use it.
 */
export const needsDockerRelay = () => !process.env.DOCKER_HOST && !fs.existsSync("/var/run/docker.sock");

export const startDockerRelay = async () => {
    const socketPath = path.join(os.tmpdir(), `promptlab-docker-${process.pid}.sock`);
    fs.rmSync(socketPath, { force: true });
    const children = new Set<ReturnType<typeof spawn>>();

    const server = net.createServer((client) => {
        const child = spawn("docker", ["system", "dial-stdio"], { stdio: ["pipe", "pipe", "ignore"] });
        children.add(child);
        client.pipe(child.stdin);
        child.stdout.pipe(client);
        const close = () => {
            client.destroy();
            child.kill();
            children.delete(child);
        };
        client.on("close", close);
        client.on("error", close);
        child.on("exit", close);
        child.stdin.on("error", close);
    });
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, resolve));

    // The engine is on the other side of the relay: its own socket path, for Ryuk's bind mount.
    process.env.DOCKER_HOST = `unix://${socketPath}`;
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = "/var/run/docker.sock";

    return async () => {
        for (const child of children) child.kill();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(socketPath, { force: true });
    };
};
