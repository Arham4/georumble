// Dependency-free canvas confetti: a short brand-colored shower behind the
// victory panel. Self-cleaning — the canvas removes itself when done — and
// it simply doesn't launch for reduced-motion users.
const COLORS = ["#5865f2", "#98a7f8", "#248046", "#6ee7a0", "#8f7d2c", "#ffffff"];

type Piece = {
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  vx: number;
  rot: number;
  vr: number;
  color: string;
  round: boolean;
};

export function launchConfetti(durationMs = 3200): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  document.body.append(canvas);

  const pieces: Piece[] = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.4,
    w: (4 + Math.random() * 5) * dpr,
    h: (8 + Math.random() * 8) * dpr,
    vy: (1.6 + Math.random() * 2.2) * dpr,
    vx: (Math.random() - 0.5) * 1.2 * dpr,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() < 0.3,
  }));

  const startedAt = performance.now();
  const step = (now: number): void => {
    const age = now - startedAt;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = Math.max(0, 1 - age / durationMs);
    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rot += piece.vr;
      if (piece.y > canvas.height + 20) {
        piece.y = -20;
        piece.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.fillStyle = piece.color;
      if (piece.round) {
        ctx.beginPath();
        ctx.arc(0, 0, piece.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      }
      ctx.restore();
    }
    if (age < durationMs) {
      requestAnimationFrame(step);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(step);
}
