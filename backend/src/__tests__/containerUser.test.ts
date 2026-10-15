import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Container hardening (issue #112): neither shipped image may run as root.
 *
 * These tests read the exact files `docker compose build` consumes, so
 * dropping the `USER` directive from a Dockerfile — or pointing the compose
 * port mapping at a port a non-root process cannot bind — fails the suite
 * before anything is built.
 */

/** Read a file from the repo root regardless of whether cwd is repo or backend. */
function repoFile(...segments: string[]): string {
  const cwd = process.cwd();
  const root = [cwd, path.resolve(cwd, "..")].find((dir) =>
    existsSync(path.join(dir, "docker-compose.yml")),
  );
  if (!root) throw new Error(`repo root not found from ${cwd}`);
  return readFileSync(path.join(root, ...segments), "utf8");
}

/**
 * The `USER` that governs the image that actually ships: everything after the
 * last `FROM`, i.e. the final stage of a multi-stage build.
 */
function runtimeUser(dockerfile: string): string | null {
  const lines = dockerfile.split("\n");
  let lastFrom = -1;
  lines.forEach((line, index) => {
    if (/^\s*FROM\s/i.test(line)) lastFrom = index;
  });
  expect(lastFrom, "Dockerfile has no FROM instruction").toBeGreaterThanOrEqual(0);

  const users = lines
    .slice(lastFrom + 1)
    .filter((line) => /^\s*USER\s+\S/i.test(line))
    .map((line) => line.replace(/^\s*USER\s+/i, "").trim().split(/\s+/)[0]);
  return users.length ? users[users.length - 1] : null;
}

describe("backend/Dockerfile", () => {
  it("runs the runtime stage as a non-root user", () => {
    const user = runtimeUser(repoFile("backend", "Dockerfile"));

    expect(user, "runtime stage declares no USER — the API, the indexer and `prisma migrate deploy` all run as uid 0").not.toBeNull();
    expect(["root", "0", "0:0"], "runtime stage switches back to root").not.toContain(user);
  });
});

describe("docker-compose.yml + frontend/nginx.conf", () => {
  it("publishes an unprivileged container port that non-root nginx listens on", () => {
    const listen = Number(/^ {4}listen\s+(\d+)\s*;/m.exec(repoFile("frontend", "nginx.conf"))?.[1]);
    // A non-root process cannot bind a port below 1024.
    expect(listen, "nginx.conf listens on a privileged port").toBeGreaterThanOrEqual(1024);

    const ports = /^ {2}frontend:$[\s\S]*?- "(\d+):(\d+)"/m.exec(repoFile("docker-compose.yml"));
    expect(ports, "frontend service publishes no port mapping").not.toBeNull();

    const containerPort = Number(ports![2]);
    expect(containerPort, "compose maps the frontend container port nginx no longer listens on").toBe(listen);
  });
});
