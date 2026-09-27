import { PublicError } from "./publicError";

export const MAX_PROVIDER_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_MODEL_LIST_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_MCP_RESPONSE_BYTES = 4 * 1024 * 1024;

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export function limitResponseBody(
  response: Response,
  maxBytes: number,
  errorMessage: string,
): Response {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maxBytes
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new PublicError(errorMessage);
  }
  if (!response.body) return response;

  let receivedBytes = 0;
  const boundedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          throw new PublicError(errorMessage);
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(boundedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  errorMessage: string,
): Promise<unknown> {
  return limitResponseBody(response, maxBytes, errorMessage).json() as Promise<unknown>;
}

export function createBoundedFetch(
  fetchImpl: FetchLike,
  maxBytes: number,
  errorMessage: string,
): FetchLike {
  return async (url, init) =>
    limitResponseBody(await fetchImpl(url, init), maxBytes, errorMessage);
}
