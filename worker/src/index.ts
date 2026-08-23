import { exchangeCode } from "./token";
import type { Env } from "./env";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/token") {
      return exchangeCode(request, env);
    }
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    return env.AppAssets.fetch(request);
  },
} satisfies ExportedHandler<Env>;
