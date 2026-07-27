import type { CSSProperties } from "react";

import { REVEAL_GRADIENT, REVEAL_RING_GRADIENT } from "./utils.js";

/**
 * Fluent-style reveal highlight with acrylic material qualities
 * (see the acrylic recipe: blur + tint + noise — the noise and tint apply
 * here; backdrop blur is intentionally omitted because this overlay sits
 * above the card's own text).
 *
 * Render inside a `group relative overflow-hidden` card that sets
 * `--rx`/`--ry` via `revealMove` on onMouseEnter and onMouseMove.
 * Layers: a large faint background wash, an acrylic noise grain masked to
 * the same halo, and a border light clipped to the card's 1px edge ring.
 */

const RING_STYLE: CSSProperties = {
  background: REVEAL_RING_GRADIENT,
  padding: "1px",
  WebkitMask:
    "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
  WebkitMaskComposite: "xor",
  mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
  maskComposite: "exclude",
};

const NOISE_TEXTURE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const NOISE_MASK =
  "radial-gradient(420px circle at var(--rx, 50%) var(--ry, 50%), #000, transparent 80%)";

const NOISE_STYLE: CSSProperties = {
  backgroundImage: NOISE_TEXTURE,
  WebkitMaskImage: NOISE_MASK,
  maskImage: NOISE_MASK,
  mixBlendMode: "soft-light",
};

export function Reveal() {
  return (
    <>
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-[450ms] ease-out group-hover:opacity-100"
        style={{ background: REVEAL_GRADIENT }}
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-[450ms] ease-out group-hover:opacity-60"
        style={NOISE_STYLE}
      />
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-[450ms] ease-out group-hover:opacity-100"
        style={RING_STYLE}
      />
    </>
  );
}
