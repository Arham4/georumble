import type { GameState } from "../game/gameClient";

export type Screen = {
  update(state: GameState): void;
  destroy(): void;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function setText(node: HTMLElement | null, text: string): void {
  if (node && node.textContent !== text) {
    node.textContent = text;
  }
}

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function accuracyPercent(correct: number, attempts: number): string {
  if (attempts === 0) {
    return "—";
  }
  return `${Math.round((correct / attempts) * 100)}%`;
}
