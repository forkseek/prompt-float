import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import {
  PACKAGED_RENDERER_SCHEME,
  PRODUCTION_RENDERER_CSP_HEADER,
} from "../../shared/securityPolicy";
import {
  isPackagedRendererDocument,
  isTrustedPackagedRendererInitiator,
  resolvePackagedRendererFile,
} from "./rendererProtocolPolicy";

type ProtocolRequest = Request & { initiatorOrigin?: string };

function rejectedResponse(status: number): Response {
  return new Response("Not found", {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function registerPackagedRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PACKAGED_RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        allowServiceWorkers: false,
        bypassCSP: false,
        codeCache: true,
        stream: false,
      },
    },
  ]);
}

export async function installPackagedRendererProtocol(
  rendererDirectory: string,
): Promise<void> {
  if (protocol.isProtocolHandled(PACKAGED_RENDERER_SCHEME)) {
    throw new Error("Packaged renderer protocol is already registered");
  }

  protocol.handle(PACKAGED_RENDERER_SCHEME, async (request) => {
    const { initiatorOrigin } = request as ProtocolRequest;
    if (!isTrustedPackagedRendererInitiator(initiatorOrigin)) {
      return rejectedResponse(403);
    }
    const filePath = resolvePackagedRendererFile(
      rendererDirectory,
      request.url,
    );
    if (!filePath) return rejectedResponse(404);

    const response = await net.fetch(pathToFileURL(filePath).href);
    if (!response.ok) return rejectedResponse(response.status);

    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    if (isPackagedRendererDocument(request.url)) {
      headers.set(
        "Content-Security-Policy",
        PRODUCTION_RENDERER_CSP_HEADER,
      );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
