/** Community invite and source repo, shown on the boot and lobby screens. */
export const DISCORD_INVITE_URL = "https://discord.gg/wGQfD6aacx";
export const GITHUB_URL = "https://github.com/Arham4/georumble";

// GitHub's official mark-github octicon (16x16 path data).
const GITHUB_MARK =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 " +
  "0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13" +
  "-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66." +
  "07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-" +
  ".08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 " +
  "2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 " +
  "2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 " +
  "2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z";

type ExternalOpener = (url: string) => void;

let openViaSdk: ExternalOpener | null = null;

/**
 * Discord's activity iframe blocks target=_blank navigation outright; the
 * embedded SDK's openExternalLink command is the sanctioned way out. The
 * boot sequence installs this once authenticated — plain browser sessions
 * never do, and keep native anchor behavior.
 */
export function setExternalLinkOpener(opener: ExternalOpener | null): void {
  openViaSdk = opener;
}

function externalLink(href: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.addEventListener("click", (event) => {
    if (!openViaSdk) {
      return;
    }
    event.preventDefault();
    openViaSdk(href);
  });
  return link;
}

export function createDiscordInviteLink(): HTMLAnchorElement {
  const link = externalLink(DISCORD_INVITE_URL);
  link.classList.add("btn", "btn-ghost", "full");
  link.textContent = "💬 Join our Discord";
  return link;
}

/** Small fixed corner button linking to the source repository. */
export function createGithubLink(): HTMLAnchorElement {
  const link = externalLink(GITHUB_URL);
  link.classList.add("github-corner");
  link.title = "GeoRumble on GitHub";
  link.setAttribute("aria-label", "Source on GitHub");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
  mark.setAttribute("d", GITHUB_MARK);
  svg.append(mark);
  link.append(svg);
  return link;
}
