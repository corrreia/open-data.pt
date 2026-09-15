/**
 * The open-data.pt mark: the armillary sphere from the Portuguese flag, reduced
 * to a ring and one tilted band. public/favicon.svg draws the same shape in the
 * light theme's brand green; here the tile follows the theme's brand token.
 */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="14" style={{ fill: "var(--color-kumo-brand)" }} />
      <g fill="none" stroke="#fff" strokeLinecap="round">
        <circle cx="32" cy="32" r="17" strokeWidth="5" />
        <ellipse cx="32" cy="32" rx="17" ry="6.5" transform="rotate(-28 32 32)" strokeWidth="3.5" />
      </g>
    </svg>
  );
}
