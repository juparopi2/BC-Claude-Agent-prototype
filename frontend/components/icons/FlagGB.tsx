type FlagGBProps = React.SVGProps<SVGSVGElement>;

/**
 * United Kingdom flag (Union Jack) — simplified SVG for small icon sizes.
 * Use className to control dimensions (e.g. "h-4 w-6").
 */
export function FlagGB({ className, ...props }: FlagGBProps) {
  return (
    <svg
      viewBox="0 0 60 30"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <rect width="60" height="30" fill="#012169" />
      <path d="M0 0l60 30M60 0L0 30" stroke="#fff" strokeWidth="6" />
      <path d="M0 0l60 30M60 0L0 30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
      <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}
