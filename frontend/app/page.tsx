'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeLogo } from '@/components/icons';

export default function LandingPage() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-6 text-center">
        <ThemeLogo variant="full" width={280} height={80} />
        <p className="text-xl text-muted-foreground">Landing Page Coming Soon</p>
        <div className="flex gap-4">
          <Link href="/login">
            <Button variant="default" size="lg">Sign In</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
