// Shared FanMas logo mark — two-tone star (pink/blue) with a comma cut out.
export default function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="FanMas"
    >
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
        <g clipPath="url(#fmL)" fill="#E94866">
          <polygon points="100,55 111.76,88.82 147.55,89.55 119.02,111.18 129.4,145.45 100,125 70.6,145.45 80.98,111.18 52.45,89.55 88.24,88.82" />
        </g>
        <g clipPath="url(#fmR)" fill="#82B2F7">
          <polygon points="100,55 111.76,88.82 147.55,89.55 119.02,111.18 129.4,145.45 100,125 70.6,145.45 80.98,111.18 52.45,89.55 88.24,88.82" />
        </g>
      </g>
    </svg>
  );
}
