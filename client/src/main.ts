import "./style.css";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

const app = document.querySelector<HTMLDivElement>("#app");

app.innerHTML = `
  <main class="shell">
    <h1>GeoRumble</h1>
    <p id="status">Connecting…</p>
  </main>
`;

const status = document.querySelector<HTMLParagraphElement>("#status");

async function boot(): Promise<void> {
  if (!CLIENT_ID) {
    status.textContent = "Dev mode: set VITE_DISCORD_CLIENT_ID to launch inside Discord.";
    return;
  }
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  const discordSdk = new DiscordSDK(CLIENT_ID);
  await discordSdk.ready();
  status.textContent = `Handshake complete — instance ${discordSdk.instanceId}`;
}

boot().catch((error: unknown) => {
  status.textContent = `Connection failed: ${String(error)}`;
});
