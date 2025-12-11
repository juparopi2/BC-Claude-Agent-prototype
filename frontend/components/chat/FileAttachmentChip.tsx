'use client';

import { FileText, X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface FileAttachmentChipProps {
  name: string;
  size: number;
  type: string;
  status: 'uploading' | 'completed' | 'error';
  progress?: number;
  onRemove: () => void;
  error?: string;
}

export function FileAttachmentChip({
  name,
  size,
  status,
  progress = 0,
  onRemove,
  error
}: FileAttachmentChipProps) {
  return (
    <div 
      className={cn(
        "relative flex items-center gap-2 px-3 py-2 rounded-md border text-sm max-w-[200px] transition-all group",
        status === 'error' 
          ? "bg-destructive/10 border-destructive/20 text-destructive" 
          : "bg-muted/50 border-border hover:bg-muted"
      )}
      role="group"
      aria-label={`Attachment: ${name}`}
    >
      {/* Icon based on status */}
      <div className="shrink-0 text-muted-foreground">
        {status === 'uploading' ? (
          <div className="relative size-4">
            <Loader2 className="size-4 animate-spin text-primary" />
            <div 
              className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-primary"
              aria-hidden="true"
            >
              {progress > 0 && progress < 100 ? progress : ''}
            </div>
          </div>
        ) : status === 'error' ? (
          <AlertCircle className="size-4 text-destructive" />
        ) : (
          <FileText className="size-4" />
        )}
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-center h-full">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn(
            "truncate font-medium",
            status === 'error' ? "text-destructive" : "text-foreground"
          )}>
            {name}
          </span>
        </div>
        
        {/* Status/Size subtext */}
        <div className="text-[10px] text-muted-foreground truncate leading-none mt-0.5">
          {status === 'uploading' ? (
            <span className="text-primary">{progress}% • {formatBytes(size)}</span>
          ) : status === 'error' ? (
             <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-destructive cursor-help underline decoration-dotted">
                    Upload failed
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{error || 'Unknown error'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span>{formatBytes(size)}</span>
          )}
        </div>
      </div>

      {/* Remove Button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "size-6 shrink-0 rounded-full -mr-1 opacity-60 group-hover:opacity-100 hover:bg-background/80 transition-opacity",
          status === 'error' && "hover:bg-destructive/10 text-destructive"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${name}`}
      >
        <X className="size-3.5" />
      </Button>

      {/* Progress Bar Background (for uploading state) */}
      {status === 'uploading' && (
        <div 
          className="absolute bottom-0 left-0 h-0.5 bg-primary/20 w-full rounded-b-md overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div 
            className="h-full bg-primary transition-all duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
