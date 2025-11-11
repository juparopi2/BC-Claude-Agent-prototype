'use client';

import { cn } from '@/lib/utils';

interface PasswordStrengthProps {
  password: string;
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const getPasswordStrength = (pwd: string): {
    score: number;
    label: string;
    color: string;
  } => {
    if (!pwd) return { score: 0, label: '', color: '' };

    let score = 0;

    // Length check
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;

    // Character variety checks
    if (/[a-z]/.test(pwd)) score += 1; // lowercase
    if (/[A-Z]/.test(pwd)) score += 1; // uppercase
    if (/[0-9]/.test(pwd)) score += 1; // numbers
    if (/[^a-zA-Z0-9]/.test(pwd)) score += 1; // special chars

    // Determine label and color
    if (score <= 2) {
      return { score: 1, label: 'Weak', color: 'bg-red-500' };
    } else if (score <= 4) {
      return { score: 2, label: 'Fair', color: 'bg-yellow-500' };
    } else if (score <= 5) {
      return { score: 3, label: 'Good', color: 'bg-blue-500' };
    } else {
      return { score: 4, label: 'Strong', color: 'bg-green-500' };
    }
  };

  const strength = getPasswordStrength(password);

  if (!password) return null;

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              level <= strength.score ? strength.color : 'bg-muted'
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Password strength: <span className="font-medium">{strength.label}</span>
      </p>
    </div>
  );
}
