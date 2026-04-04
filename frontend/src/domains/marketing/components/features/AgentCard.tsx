// No 'use client' — pure presentational, GSAP hover handled by AgentsSection container

interface AgentCardProps {
  icon: string;
  name: string;
  role: string;
  description: string;
  color: string;
  highlighted?: boolean;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

export function AgentCard({
  icon,
  name,
  role,
  description,
  color,
  highlighted = false,
}: AgentCardProps) {
  const rgb = hexToRgb(color);

  return (
    <div
      className={`agent-card relative flex h-full flex-col gap-4 rounded-2xl border transition-colors duration-200 ${
        highlighted ? 'p-6 sm:p-8' : 'p-5'
      }`}
      data-agent-color={color}
      style={{
        borderColor: `rgba(${rgb}, 0.3)`,
        borderLeftWidth: '3px',
        borderLeftColor: color,
        backgroundColor: `rgba(${rgb}, 0.04)`,
      }}
    >
      <div
        className={`flex shrink-0 items-center justify-center rounded-xl ${
          highlighted ? 'h-12 w-12 text-2xl' : 'h-10 w-10 text-xl'
        }`}
        style={{ backgroundColor: `rgba(${rgb}, 0.12)` }}
      >
        <span role="img" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={`font-semibold text-foreground ${highlighted ? 'text-xl' : 'text-base'}`}
          >
            {name}
          </h3>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-foreground/70"
            style={{ backgroundColor: `rgba(${rgb}, 0.12)` }}
          >
            {role}
          </span>
        </div>
        <p
          className={`leading-relaxed text-muted-foreground ${highlighted ? 'text-sm sm:text-base' : 'text-sm'}`}
        >
          {description}
        </p>
      </div>
    </div>
  );
}
