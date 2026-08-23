export type Env = {
  AppAssets: Fetcher;
  ROOM: DurableObjectNamespace;
  BROKER: DurableObjectNamespace;
  LIMITS_KV: KVNamespace | undefined;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_BOT_TOKEN: string | undefined;
  CF_ACCOUNT_ID: string | undefined;
  CF_API_TOKEN: string | undefined;
};
