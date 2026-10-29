/**
 * Typed tool failure for the marketing plugin — surfaced to the model as a
 * structured error (code + message), never a crash. Lives in its own module so
 * the connection store and the runtime can both raise typed errors without a
 * dependency cycle.
 */
export class MarketingToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketingToolError';
  }
}
