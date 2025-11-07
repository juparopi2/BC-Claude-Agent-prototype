'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChangeSummaryProps {
  title: string;
  description: string;
  changes: Record<string, unknown>;
  impact: 'high' | 'medium' | 'low';
}

/**
 * ChangeSummary Component
 *
 * Displays a summary of changes that will be applied when an approval is granted.
 * Shows the title, description, impact level, and a formatted list of changes.
 *
 * @param props - Component props
 * @param props.title - Title of the change (e.g., "Create New Customer")
 * @param props.description - Description of what will happen
 * @param props.changes - Object containing the changes as key-value pairs
 * @param props.impact - Impact level of the change (high/medium/low)
 */
export function ChangeSummary({
  title,
  description,
  changes,
  impact,
}: ChangeSummaryProps) {
  // Get impact icon and color
  const getImpactDetails = () => {
    switch (impact) {
      case 'high':
        return {
          icon: AlertTriangle,
          color: 'text-red-600 dark:text-red-400',
          bgColor: 'bg-red-50 dark:bg-red-950',
          badgeVariant: 'destructive' as const,
        };
      case 'medium':
        return {
          icon: AlertCircle,
          color: 'text-yellow-600 dark:text-yellow-400',
          bgColor: 'bg-yellow-50 dark:bg-yellow-950',
          badgeVariant: 'default' as const,
        };
      case 'low':
        return {
          icon: Info,
          color: 'text-blue-600 dark:text-blue-400',
          bgColor: 'bg-blue-50 dark:bg-blue-950',
          badgeVariant: 'secondary' as const,
        };
    }
  };

  const { icon: Icon, color, bgColor, badgeVariant } = getImpactDetails();

  // Format a value for display
  const formatValue = (value: unknown): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <Card className="w-full">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge variant={badgeVariant} className="flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {impact.toUpperCase()} IMPACT
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Impact indicator banner */}
        <div className={cn('rounded-md p-3 flex items-center gap-2 text-sm', bgColor, color)}>
          <Icon className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">
            {impact === 'high' && 'This action will make significant changes to your data.'}
            {impact === 'medium' && 'This action will modify existing data.'}
            {impact === 'low' && 'This action will make minor changes.'}
          </span>
        </div>

        {/* Changes list */}
        {Object.keys(changes).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground">Changes to be applied:</h4>
            <div className="rounded-md border bg-muted/50 p-4 space-y-2">
              {Object.entries(changes).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[120px_1fr] gap-4 text-sm">
                  <span className="font-medium text-foreground">{key}:</span>
                  <span className="text-muted-foreground font-mono text-xs break-all">
                    {formatValue(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {Object.keys(changes).length === 0 && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            No specific changes to display
          </div>
        )}
      </CardContent>
    </Card>
  );
}
