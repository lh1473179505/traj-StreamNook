// The official Twitch marks, inlined the way the Discord/YouTube/X glyphs are
// (lucide dropped brand icons, so the product's own logo lives here).
// fill="currentColor" so the surrounding text color drives it — pass the Twitch
// purple (#9146FF) at the call site when you want the branded color.

// The Twitch "glitch" wordmark cube. Complete mark: the two leading subpaths are
// the eyes (the inner vertical bars), then the screen frame.
export function TwitchGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={`flex-shrink-0 ${className}`}
    >
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

// The Twitch verified / partner mark (scalloped badge with an inset checkmark).
export function TwitchVerifiedMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={`flex-shrink-0 ${className}`}
    >
      <path
        fillRule="evenodd"
        d="M12.5 3.5 8 2 3.5 3.5 2 8l1.5 4.5L8 14l4.5-1.5L14 8l-1.5-4.5ZM7 11l4.5-4.5L10 5 7 8 5.5 6.5 4 8l3 3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default TwitchGlyph;
