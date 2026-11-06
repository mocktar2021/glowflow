type BrandLogoProps = {
  className?: string;
  compact?: boolean;
};

/** Owner-approved GlowFlow wordmark. The halo stays champagne in both themes. */
export function BrandLogo({ className = "", compact = false }: BrandLogoProps) {
  if (compact) {
    return (
      <svg aria-label="GlowFlow" role="img" viewBox="-60 30 220 240" className={className}>
        <g fill="none" stroke="currentColor" strokeWidth="14">
          <circle cx="50" cy="150" r="43" />
          <path d="M93 100V218a34 34 0 0 1-34 34H14" />
        </g>
        <path d="M3.93 108.51a62 62 0 0 1 92.14 0" fill="none" stroke="#c8a27a" strokeWidth="7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg aria-label="GlowFlow" role="img" viewBox="-10 20 754 260" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="butt">
        <circle cx="50" cy="150" r="43" />
        <path d="M93 100V218a34 34 0 0 1-34 34H14" />
        <path d="M127 36v164" />
        <circle cx="204" cy="150" r="43" />
        <clipPath id="gf-wordmark-w"><rect x="262" y="100" width="124" height="100" /></clipPath>
        <path clipPath="url(#gf-wordmark-w)" strokeLinejoin="miter" d="m274 70 24 160 26-160 26 160 24-160" />
        <path d="M407 200V72a30 30 0 0 1 30-30h14M390 107h57M487 36v164" />
        <circle cx="564" cy="150" r="43" />
        <clipPath id="gf-wordmark-w2"><rect x="622" y="100" width="124" height="100" /></clipPath>
        <path clipPath="url(#gf-wordmark-w2)" strokeLinejoin="miter" d="m634 70 24 160 26-160 26 160 24-160" />
      </g>
      <path d="M157.93 108.51a62 62 0 0 1 92.14 0" fill="none" stroke="#c8a27a" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
