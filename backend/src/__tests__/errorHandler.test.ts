import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AppError, errorHandler } from "../middleware/errorHandler";
import type { NextFunction, Request, Response } from "express";

describe("errorHandler", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: any;
  const originalNodeEnv = process.env.NODE_ENV;
  const noopNext = (() => {}) as unknown as NextFunction;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    req = {
      method: "POST",
      path: "/api/jobs/1/assign",
    };
    res = {
      status: statusMock as unknown as Response["status"],
    };
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    consoleErrorSpy.mockRestore();
  });

  it("handles 4xx AppError without logging to console.error", () => {
    process.env.NODE_ENV = "production";
    const err = new AppError(400, "Invalid Stellar address");

    errorHandler(err, req as Request, res as Response, noopNext);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Invalid Stellar address" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("handles 404 AppError without logging", () => {
    process.env.NODE_ENV = "production";
    const err = new AppError(404, "Job not found");

    errorHandler(err, req as Request, res as Response, noopNext);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Job not found" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("suppresses error logging when NODE_ENV is 'test'", () => {
    process.env.NODE_ENV = "test";
    const err = new Error("Database connection timed out");

    errorHandler(err, req as Request, res as Response, noopNext);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs unexpected 5xx errors with method, path, and error in non-test environments", () => {
    process.env.NODE_ENV = "production";
    const err = new Error("Uncaught database failure");

    errorHandler(err, req as Request, res as Response, noopNext);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[error] POST /api/jobs/1/assign", err);
  });

  it("logs AppError with status >= 500 in development", () => {
    process.env.NODE_ENV = "development";
    const err = new AppError(503, "Service unavailable");

    errorHandler(err, req as Request, res as Response, noopNext);

    expect(statusMock).toHaveBeenCalledWith(503);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith("[error] POST /api/jobs/1/assign", err);
  });
});
