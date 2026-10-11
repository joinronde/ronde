/**
 * Ronde logo: the table, the participants around it, and the person who has the floor. Animated, the floor
 * passes from seat to seat ("loop": all the time; "hover": while pointed at; reduced motion: never).
 */
export function Logo({ className = "logo", motion }: { className?: string; motion?: "loop" | "hover" }) {
  return (
    <svg className={motion ? `${className} lg-${motion}` : className} viewBox="0 0 32 32" aria-hidden="true">
      <circle className="lg-trk" cx="16" cy="16" r="8" />
      <circle className="lg-dot" cx="16" cy="2.8" r="1.9" />
      <circle className="lg-dot" cx="27.4" cy="9.4" r="1.9" />
      <circle className="lg-dot" cx="27.4" cy="22.6" r="1.9" />
      <circle className="lg-dot" cx="16" cy="29.2" r="1.9" />
      <circle className="lg-dot" cx="4.6" cy="22.6" r="1.9" />
      <circle className="lg-dot" cx="4.6" cy="9.4" r="1.9" />
      <g className="lg-turn">
        <path className="lg-arc" d="M16 8 A8 8 0 0 1 22.93 20" />
        <circle className="lg-on" cx="27.4" cy="22.6" r="2.8" />
      </g>
    </svg>
  );
}
