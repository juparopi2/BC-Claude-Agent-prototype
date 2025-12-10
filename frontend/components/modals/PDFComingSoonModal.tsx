'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';

interface PDFComingSoonModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
}

export function PDFComingSoonModal({
  isOpen,
  onClose,
  fileName,
}: PDFComingSoonModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-amber-500" />
            PDF Visualizer
          </DialogTitle>
          <DialogDescription>
            {fileName}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
          <div className="bg-amber-100 dark:bg-amber-900/20 p-4 rounded-full">
            <FileText className="size-10 text-amber-600 dark:text-amber-500" />
          </div>
          <h3 className="text-lg font-semibold">Coming Soon</h3>
          <p className="text-muted-foreground text-sm max-w-[80%]">
            We&apos;re building a powerful PDF visualizer for you. Check back later!
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
