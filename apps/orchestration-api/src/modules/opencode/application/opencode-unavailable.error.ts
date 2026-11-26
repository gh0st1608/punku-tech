export class OpenCodeUnavailableError extends Error {
  constructor() {
    super("OpenCode is unavailable or incompatible with the configured version.");
    this.name = "OpenCodeUnavailableError";
  }
}
