import { ErrorRequestHandler } from "express";

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err instanceof AppError ? err.statusCode : 500;
  const message = status < 500 ? err.message : "Internal server error";

  if (status >= 500 && process.env.NODE_ENV !== "test") {
    console.error(`[error] ${req.method} ${req.path}`, err);
  }

  res.status(status).json({ error: message });
};

