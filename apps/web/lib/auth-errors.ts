"use client";
import { explainAuthError, type AuthErrorInfo } from "@atlas/auth/onboarding";
import { ApiError } from "./api";

export * from "@atlas/auth/onboarding";

export type Explained = AuthErrorInfo & { code: string; details?: any; status?: number };

/** Turns anything thrown by the sign-in flow (API errors, network failures, WebAuthn errors) into a catalog entry. */
export function toAuthError(e: unknown): Explained {
  if (e instanceof ApiError) {
    const base = explainAuthError(e.code, e.message);
    return { ...base, details: e.details, status: e.status };
  }
  const err = e as { name?: string; message?: string; code?: string } | undefined;
  if (err?.name === "NotAllowedError" || err?.name === "AbortError") return explainAuthError("PASSKEY_CANCELLED");
  if (err?.name === "InvalidStateError") return { ...explainAuthError("PASSKEY_REJECTED"), message: "This device already has an ATLAS passkey for this account." };
  if (err?.name === "TypeError" || /fetch|network|Failed to fetch|JSON/i.test(err?.message ?? "")) return explainAuthError("NETWORK");
  if (err?.code) return explainAuthError(err.code, err.message);
  return explainAuthError("UNKNOWN", err?.message);
}
