// One-off visual effects (confetti), turned off in "reduced motion" mode

export function motionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (document.body.classList.contains("calm")) return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const COLORS = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--sun)"];

export function confetti(count = 70) {
  if (!motionAllowed()) return;
  const layer = document.getElementById("fx");
  if (!layer) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "confetti";
    const t = 2 + Math.random() * 1.6;
    p.style.left = Math.random() * 100 + "%";
    p.style.background = COLORS[i % COLORS.length]!;
    p.style.setProperty("--dx", (Math.random() - 0.5) * 240 + "px");
    p.style.setProperty("--r", (Math.random() - 0.5) * 1080 + "deg");
    p.style.setProperty("--t", t + "s");
    p.style.animationDelay = Math.random() * 0.4 + "s";
    layer.appendChild(p);
    setTimeout(() => p.remove(), (t + 0.5) * 1000);
  }
}
