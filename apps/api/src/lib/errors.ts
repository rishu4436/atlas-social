export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}
export const unauthorized = (code = "AUTH_REQUIRED", msg = "Sign in required") => new ApiError(401, code, msg);
export const forbidden = (code = "FORBIDDEN", msg = "Not allowed") => new ApiError(403, code, msg);
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, msg: string) => new ApiError(409, code, msg);
export const bad = (code: string, msg: string, details?: unknown) => new ApiError(400, code, msg, details);
