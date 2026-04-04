type FlagDKProps = React.SVGProps<SVGSVGElement>;

/**
 * Denmark flag (Dannebrog) — red field with white Scandinavian cross.
 * Use className to control dimensions (e.g. "h-4 w-6").
 */
export function FlagDK({ className, ...props }: FlagDKProps) {
  return (
    <svg
      viewBox="0 0 37 28"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <rect width="37" height="28" fill="#C8102E" />
      <rect x="12" width="4" height="28" fill="#fff" />
      <rect y="12" width="37" height="4" fill="#fff" />
    </svg>
  );
}
