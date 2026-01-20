'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/src/domains/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertTriangle, WifiOff, ShieldAlert } from 'lucide-react';

/**
 * Alert info for different auth failure scenarios
 */
interface AlertInfo {
  variant: 'warning' | 'error';
  title: string;
  message: string;
  icon: React.ReactNode;
}

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, error, authFailureReason, getLoginUrl } = useAuthStore();

  // AuthProvider already checks auth on mount, no need to duplicate here

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.push('/new');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  /**
   * Get alert info based on auth failure reason
   */
  const alertInfo = useMemo((): AlertInfo | null => {
    if (authFailureReason === 'session_expired') {
      return {
        variant: 'warning',
        title: 'Sesión Expirada',
        message: 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.',
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    }
    if (authFailureReason === 'network_error') {
      return {
        variant: 'error',
        title: 'Error de Conexión',
        message: 'No se pudo conectar al servidor. Verifica tu conexión.',
        icon: <WifiOff className="h-4 w-4" />,
      };
    }
    if (error && authFailureReason !== 'not_authenticated') {
      return {
        variant: 'error',
        title: 'Error',
        message: error,
        icon: <ShieldAlert className="h-4 w-4" />,
      };
    }
    return null;
  }, [authFailureReason, error]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-muted/40">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription>
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {alertInfo && (
            <div
              className={`rounded-md p-3 text-sm ${
                alertInfo.variant === 'warning'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                  : 'bg-destructive/15 text-destructive'
              }`}
            >
              <div className="flex items-center gap-2">
                {alertInfo.icon}
                <span className="font-medium">{alertInfo.title}</span>
              </div>
              <p className="mt-1 ml-6">{alertInfo.message}</p>
            </div>
          )}
          
          <Button 
            className="w-full" 
            size="lg" 
            onClick={handleLogin}
          >
            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="microsoft" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
              <path fill="currentColor" d="M0 32h214.6v214.6H0V32zm233.4 0H448v214.6H233.4V32zM0 265.4h214.6V480H0V265.4zm233.4 0H448V480H233.4V265.4z"></path>
            </svg>
            Sign in with Microsoft
          </Button>
          
          <p className="px-8 text-center text-xs text-muted-foreground">
            By clicking continue, you agree to our{' '}
            <a href="#" className="underline underline-offset-4 hover:text-primary">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
