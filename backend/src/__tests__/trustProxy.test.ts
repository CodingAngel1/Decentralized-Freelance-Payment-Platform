import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import type { Server } from "node:http";

describe("trust proxy and rate limiting", () => {
  let server: Server;
  let baseUrl: string;
  const recordedIps: string[] = [];

  beforeAll(async () => {
    const app = express();
    // Simulate config.TRUST_PROXY = 1 (1 hop behind reverse proxy, e.g. Render/Nginx)
    const TRUST_PROXY_HOPS = 1;
    app.set("trust proxy", TRUST_PROXY_HOPS);

    const limiter = rateLimit({
      windowMs: 60_000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use("/test-rate-limit", limiter, (req, res) => {
      recordedIps.push(req.ip ?? "unknown");
      res.json({ ip: req.ip });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port assigned");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("extracts real client IP from X-Forwarded-For when trust proxy is set to 1 hop", async () => {
    recordedIps.length = 0;
    const clientIp = "198.51.100.42";

    const res = await fetch(`${baseUrl}/test-rate-limit`, {
      headers: {
        "X-Forwarded-For": clientIp,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ip: string };
    expect(body.ip).toBe(clientIp);
    expect(recordedIps).toContain(clientIp);
  });

  it("rate limits by the real client IP rather than shared proxy IP", async () => {
    const clientIpA = "203.0.113.1";
    const clientIpB = "203.0.113.2";

    // Client A makes 2 requests (reaches limit)
    const resA1 = await fetch(`${baseUrl}/test-rate-limit`, {
      headers: { "X-Forwarded-For": clientIpA },
    });
    expect(resA1.status).toBe(200);

    const resA2 = await fetch(`${baseUrl}/test-rate-limit`, {
      headers: { "X-Forwarded-For": clientIpA },
    });
    expect(resA2.status).toBe(200);

    // Client A 3rd request should be 429
    const resA3 = await fetch(`${baseUrl}/test-rate-limit`, {
      headers: { "X-Forwarded-For": clientIpA },
    });
    expect(resA3.status).toBe(429);

    // Client B should NOT be blocked even though both connect to the same server
    const resB1 = await fetch(`${baseUrl}/test-rate-limit`, {
      headers: { "X-Forwarded-For": clientIpB },
    });
    expect(resB1.status).toBe(200);
  });

  it("extracts client IP across multiple hops when hop count matches", async () => {
    const multiApp = express();
    multiApp.set("trust proxy", 2);
    multiApp.get("/multi-hop", (req, res) => res.json({ ip: req.ip }));

    const s = multiApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => s.on("listening", resolve));
    const port = (s.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/multi-hop`, {
        headers: { "X-Forwarded-For": "198.51.100.99, 10.0.0.1" },
      });
      const data = (await res.json()) as { ip: string };
      expect(data.ip).toBe("198.51.100.99");
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});
