export class StopError extends Error {
  constructor(message: string, public exitCode = 1) { super(message); }
}
