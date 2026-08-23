import type { Env } from "./env";

type TokenResponse = { access_token?: string; error?: string };

export async function exchangeCode(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ code?: string }>();
  if (!body.code) {
    return Response.json({ error: "missing code" }, { status: 400 });
  }

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: body.code,
    }),
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    return Response.json({ error: "token exchange failed" }, { status: 401 });
  }
  return Response.json({ access_token: payload.access_token });
}
