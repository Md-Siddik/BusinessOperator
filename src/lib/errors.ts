/** Application errors that are safe to show to the user. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthorized: (message = "Authentication required") => new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You don't have permission to do that") => new AppError(403, "FORBIDDEN", message),
  /** Also used for resources the actor may not see, so IDs never reveal existence. */
  notFound: (message = "Not found") => new AppError(404, "NOT_FOUND", message),
  badRequest: (message: string, details?: Record<string, unknown>) => new AppError(400, "BAD_REQUEST", message, details),
  conflict: (message: string, details?: Record<string, unknown>) => new AppError(409, "CONFLICT", message, details),
  tooManyRequests: (message = "Too many requests. Please try again shortly.") => new AppError(429, "RATE_LIMITED", message),
};
