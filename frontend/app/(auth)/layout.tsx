import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In | BC Claude Agent',
  description: 'Sign in to BC Claude Agent',
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
