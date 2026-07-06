// FanMas logo mark — the two-tone star (pink/blue) with a comma cutout, set in
// a rounded tile. The tile gives the mark edges + contrast on dark surfaces and
// keeps the fine detail legible at small sizes (the bare mark muddies < 32px).
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const inner = Math.round(size * 0.68);
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.28)),
        background: "linear-gradient(140deg, #23232f, #141419)",
        border: "1px solid #2c2c3b",
        flexShrink: 0,
        boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FanMas">
        <defs>
          <clipPath id="fmL"><rect width="100" height="200" /></clipPath>
          <clipPath id="fmR"><rect x="100" width="100" height="200" /></clipPath>
          <mask id="fmC">
            <rect width="200" height="200" fill="#fff" />
            <g fill="#000">
              <circle cx="108" cy="87" r="16" />
              <path d="M100,98 C98,113 88,123 74,135 C94,135 110,121 114,103 C115,99 113,96 109,95 Z" />
            </g>
          </mask>
        </defs>
        <g mask="url(#fmC)">
          <g clipPath="url(#fmL)" fill="#F1567A"><polygon points="100,55 111.76,88.82 147.55,89.55 119.02,111.18 129.4,145.45 100,125 70.6,145.45 80.98,111.18 52.45,89.55 88.24,88.82" /></g>
          <g clipPath="url(#fmR)" fill="#8FBBFB"><polygon points="100,55 111.76,88.82 147.55,89.55 119.02,111.18 129.4,145.45 100,125 70.6,145.45 80.98,111.18 52.45,89.55 88.24,88.82" /></g>
        </g>
      </svg>
    </span>
  );
}

// Full lockup: tiled mark + two-tone "FanMas" wordmark. Use in nav/login/headers.
export default function Logo({ size = 28, showWordmark = false }: { size?: number; showWordmark?: boolean }) {
  if (!showWordmark) return <LogoMark size={size} />;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark size={size} />
      <Wordmark />
    </span>
  );
}

export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: "-0.02em", lineHeight: 1, color: "#EAEEF7" }}>
      Fan<span style={{ color: "#F1567A" }}>Mas</span>
    </span>
  );
}
