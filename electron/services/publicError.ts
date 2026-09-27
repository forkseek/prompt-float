export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

export function toPublicErrorMessage(
  error: unknown,
  fallback = "操作失败，请稍后重试",
): string {
  if (error instanceof PublicError) {
    return error.message;
  }
  return fallback;
}
