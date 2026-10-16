import { describe, expect, it } from "vitest";
import dockerfile from "../../Dockerfile?raw";
import nginxConf from "../../nginx.conf?raw";

/**
 * Container hardening (issue #112): the frontend image must not run nginx as
 * root, and it must listen on a port an unprivileged process is allowed to
 * bind. Both files are the ones `docker compose build` copies into the image.
 */

/** Everything after the last `FROM` — the stage that actually ships. */
function runtimeStage(source: string): string {
  const lines = source.split("\n");
  let lastFrom = -1;
  lines.forEach((line, index) => {
    if (/^\s*FROM\s/i.test(line)) lastFrom = index;
  });
  expect(lastFrom, "Dockerfile has no FROM instruction").toBeGreaterThanOrEqual(0);
  return lines.slice(lastFrom + 1).join("\n");
}

function runtimeUser(source: string): string | null {
  const users = runtimeStage(source)
    .split("\n")
    .filter((line) => /^\s*USER\s+\S/i.test(line))
    .map((line) => line.replace(/^\s*USER\s+/i, "").trim().split(/\s+/)[0]);
  return users.length ? users[users.length - 1] : null;
}

function listenPort(conf: string): number {
  return Number(/^\s*listen\s+(\d+)\s*;/m.exec(conf)?.[1]);
}

describe("frontend/Dockerfile", () => {
  it("runs nginx as a non-root user", () => {
    const user = runtimeUser(dockerfile);

    expect(user, "runtime stage declares no USER — the nginx master and workers run as root").not.toBeNull();
    expect(["root", "0", "0:0"], "runtime stage switches back to root").not.toContain(user);
  });

  it("exposes the port nginx actually listens on", () => {
    const listen = listenPort(nginxConf);
    expect(listen, "nginx.conf listens on a privileged port a non-root process cannot bind").toBeGreaterThanOrEqual(1024);

    const expose = Number(/(?:^|\n)\s*EXPOSE\s+(\d+)/i.exec(runtimeStage(dockerfile))?.[1]);
    expect(expose, "runtime stage does not EXPOSE the nginx listen port").toBe(listen);
  });

  it("supports configurable VITE_API_URL build argument for nginx reverse proxy (issue #55)", () => {
    expect(dockerfile).toMatch(/^\s*ARG\s+VITE_API_URL=/m);
    expect(dockerfile).toMatch(/VITE_API_URL=\$VITE_API_URL/);
    expect(nginxConf).toMatch(/location\s+\/api\/\s*\{\s*proxy_pass\s+http:\/\/backend:3000;/);
  });
});
