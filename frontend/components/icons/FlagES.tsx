type FlagESProps = React.SVGProps<SVGSVGElement>;

/**
 * Spain flag — red/yellow/red horizontal stripes.
 * Use className to control dimensions (e.g. "h-4 w-6").
 */
export function FlagES({ className, ...props }: FlagESProps) {
  return (
    <svg
      viewBox="0 0 6 4"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <rect width="6" height="4" fill="#AA151B" />
      <rect y="1" width="6" height="2" fill="#F1BF00" />
    </svg>
  );
}
