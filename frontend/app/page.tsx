'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight">BC Agent</h1>
        <p className="text-xl text-muted-foreground">Landing Page Coming Soon</p>
        <div className="flex gap-4">
          <Link href="/login">
            <Button variant="default">Sign In</Button>
          </Link>
          <Link href="/new">
            <Button variant="outline">Go to App (Protected)</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
