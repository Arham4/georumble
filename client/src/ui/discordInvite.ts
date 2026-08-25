/** Community invite, shown on the boot and lobby screens. */
export const DISCORD_INVITE_URL = "https://discord.gg/wGQfD6aacx";

export function createDiscordInviteLink(): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = DISCORD_INVITE_URL;
  // External navigation from inside Discord's embedded webview is
  // best-effort; in a plain browser this always behaves normally.
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.classList.add("btn", "btn-ghost", "full", "invite-link");
  link.textContent = "💬 Join our Discord";
  return link;
}
