'use client';

import { Building2, Cloud, Globe, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ConnectionSummary, ProviderId, ConnectionStatus } from '@bc-agent/shared';
import {
  PROVIDER_DISPLAY_NAME,
  PROVIDER_ICON,
} from '@bc-agent/shared';

// ============================================
// Icon mapping (lucide-react name → component)
// ============================================

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2,
  Cloud,
  Globe,
  BarChart3,
};

// ============================================
// Status badge config
// ============================================

const STATUS_BADGE: Record<ConnectionStatus | 'coming_soon', { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  connected: { label: 'Connected', variant: 'default' },
  disconnected: { label: 'Configure', variant: 'outline' },
  expired: { label: 'Expired', variant: 'destructive' },
  error: { label: 'Error', variant: 'destructive' },
  coming_soon: { label: 'Coming soon', variant: 'secondary' },
};

// ============================================
// Props
// ============================================

interface ConnectionCardProps {
  providerId: ProviderId;
  connection: ConnectionSummary | null;
  disabled?: boolean;
}

// ============================================
// Component
// ============================================

export function ConnectionCard({ providerId, connection, disabled = false }: ConnectionCardProps) {
  const displayName = PROVIDER_DISPLAY_NAME[providerId];
  const iconName = PROVIDER_ICON[providerId];
  const IconComponent = ICON_MAP[iconName] ?? Cloud;

  const status: ConnectionStatus | 'coming_soon' = connection
    ? connection.status
    : disabled
      ? 'coming_soon'
      : 'disconnected';
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.coming_soon;

  const isInactive = disabled || !connection;

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border bg-card ${
        isInactive ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <IconComponent
          className={`size-5 ${isInactive ? 'text-muted-foreground' : 'text-primary'}`}
        />
        <span
          className={`text-sm font-medium ${
            isInactive ? 'text-muted-foreground' : ''
          }`}
        >
          {connection?.displayName ?? displayName}
        </span>
      </div>
      <Badge variant={badge.variant}>{badge.label}</Badge>
    </div>
  );
}
