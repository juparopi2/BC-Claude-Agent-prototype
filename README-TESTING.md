# Testing Guide - BC Claude Agent

## 📋 Tabla de Contenidos

1. [Overview](#overview)
2. [Testing Infrastructure](#testing-infrastructure)
3. [Running Tests](#running-tests)
4. [Writing Tests](#writing-tests)
5. [CI/CD Integration](#cicd-integration)
6. [Coverage Goals](#coverage-goals)
7. [Troubleshooting](#troubleshooting)

---

## Overview

Este proyecto utiliza una estrategia de testing completa con:

- **Unit Tests**: Vitest (backend + frontend)
- **E2E Tests**: Playwright (chromium + firefox)
- **Pre-push hooks**: Husky (local enforcement)
- **CI/CD**: GitHub Actions (non-bypassable gatekeeper)

**Estado Actual**:
- ✅ Infrastructure 100% completada
- ⏳ Tests parcialmente implementados (ejemplo + ApprovalManager)
- ✅ CI/CD pipeline configurado

---

## Testing Infrastructure

### Backend Testing (Vitest + MSW)

**Ubicación**: `backend/src/__tests__/`

**Frameworks**:
- `vitest@2.1.8` - Test runner
- `@vitest/ui@2.1.8` - UI para tests
- `msw@2.6.0` - HTTP mocking
- `supertest@7.0.0` - API testing

**Configuración**: `backend/vitest.config.ts`

**Coverage Target**: 70% (branches, functions, lines, statements)

### Frontend Testing (Vitest + RTL)

**Ubicación**: `frontend/__tests__/`

**Frameworks**:
- `vitest@2.1.8` - Test runner
- `@testing-library/react@16.1.0` - Component testing
- `@testing-library/jest-dom@6.6.3` - DOM matchers
- `@testing-library/user-event@14.5.2` - User interactions
- `jsdom@25.0.1` - DOM environment

**Configuración**: `frontend/vitest.config.ts`

**Coverage Target**: 70%

### E2E Testing (Playwright)

**Ubicación**: `e2e/`

**Framework**: `@playwright/test@1.49.1`

**Configuración**: `playwright.config.ts`

**Browsers**: Chromium 131.0.6778.33, Firefox 132.0

**Features**:
- Auto-start backend + frontend servers
- Single worker (stateful sessions)
- Screenshots + videos on failure
- HTML reports

---

## Running Tests

### Backend Tests

```bash
cd backend

# Run all tests
npm test

# Watch mode (auto-rerun on file changes)
npm run test:watch

# UI mode (visual test explorer)
npm run test:ui

# Coverage report
npm run test:coverage
```

### Frontend Tests

```bash
cd frontend

# Run all tests
npm test

# Watch mode
npm run test:watch

# UI mode
npm run test:ui

# Coverage report
npm run test:coverage
```

### E2E Tests

```bash
# Run E2E tests (from project root)
npm run test:e2e

# UI mode (visual debugger)
npm run test:e2e:ui

# Headed mode (see browser)
npm run test:e2e:headed

# Debug mode (step through tests)
npm run test:e2e:debug

# Single browser
npm run test:e2e:chromium
npm run test:e2e:firefox
```

### Run All Tests

```bash
# Backend + Frontend + E2E
cd backend && npm test && cd ../frontend && npm test && cd .. && npm run test:e2e
```

---

## Writing Tests

### Backend Unit Test Example

```typescript
// backend/src/__tests__/unit/MyService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyService } from '@/services/MyService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService();
  });

  it('should do something', () => {
    const result = service.doSomething();
    expect(result).toBe('expected value');
  });
});
```

### Frontend Component Test Example

```typescript
// frontend/__tests__/unit/MyComponent.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from '@/components/MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### E2E Test Example

```typescript
// e2e/my-flow.spec.ts
import { test, expect } from '@playwright/test';

test('should complete user flow', async ({ page }) => {
  await page.goto('/');
  await page.click('button:has-text("Login")');
  await expect(page).toHaveURL('/dashboard');
});
```

---

## CI/CD Integration

### Husky Pre-push Hook

**Ubicación**: `.husky/pre-push`

**Comportamiento**:
- Ejecuta tests de backend + frontend antes de push
- Bloquea push si algún test falla
- Bypassable con `git push --no-verify` (⚠️ NO recomendado)

**Trigger**:
```bash
git push origin main
# ⏳ Ejecuta tests automáticamente...
```

### GitHub Actions Workflow

**Ubicación**: `.github/workflows/test.yml`

**Triggers**:
- Push a `main` o `develop`
- Pull requests a `main` o `develop`

**Jobs**:
1. **backend-tests**: Linter + Type Check + Tests + Coverage
2. **frontend-tests**: Linter + Type Check + Tests + Coverage
3. **e2e-tests**: Playwright tests (depende de 1 y 2)

**Artifacts**:
- Playwright reports (30 días de retención)
- Coverage reports (Codecov integration)

**Non-bypassable**:
- ✅ Branch protection rules en GitHub
- ✅ Require "Tests" workflow to pass
- ✅ Solo admins pueden override (emergency merges)

---

## Coverage Goals

### Target: 70%

**Rational**:
- Pragmatic goal (industry standard)
- Achievable en 2-3 semanas
- Covers critical business paths
- Balance between coverage y development velocity

### Coverage por Proyecto

| Proyecto | Target | Actual | Status |
|----------|--------|--------|--------|
| Backend | 70% | ~5% | ⏳ In Progress |
| Frontend | 70% | ~1% | ⏳ In Progress |

### Enforcement

**Local**:
- Vitest config con thresholds de 70%
- Tests fallan si coverage < 70%

**CI/CD**:
- GitHub Actions ejecuta `npm run test:coverage`
- Build falla si no se alcanza threshold

---

## Troubleshooting

### Tests fallan localmente pero pasan en CI

**Causa**: Diferencias de entorno (Windows vs Linux)

**Solución**:
```bash
# Limpiar cache y reinstalar
rm -rf node_modules package-lock.json
npm install
```

### Playwright no encuentra los browsers

**Causa**: Browsers no instalados

**Solución**:
```bash
npx playwright install chromium firefox
```

### Tests timeout en E2E

**Causa**: Servidores no arrancan a tiempo

**Solución**:
- Aumentar `timeout` en `playwright.config.ts`
- Verificar puertos 3000 y 3002 disponibles

### Coverage no se genera

**Causa**: Vitest coverage provider no instalado

**Solución**:
```bash
# Backend
cd backend && npm install --save-dev @vitest/coverage-v8

# Frontend
cd frontend && npm install --save-dev @vitest/coverage-v8
```

### Husky hooks no se ejecutan

**Causa**: Hooks no tienen permisos de ejecución

**Solución**:
```bash
chmod +x .husky/pre-push
```

---

## Roadmap

### Phase 3 - Critical Tests (⏳ In Progress)

**Backend**:
- [ ] DirectAgentService tests (8 tests)
- [x] ApprovalManager tests (3/11 passing)
- [ ] TodoManager tests (5 tests)
- [ ] Integration tests (sessions, agent, approvals)

**Frontend**:
- [ ] ChatInterface tests (6 tests)
- [ ] useChat hook tests (5 tests)
- [ ] useSocket hook tests (4 tests)

**E2E**:
- [ ] Chat flow tests (6 tests)
- [ ] Approval flow tests (5 tests)

**Timeline**: 40-50 horas (5-6 días)

### Phase 4 - Enforcement (✅ COMPLETE)

- [x] Husky pre-push hooks
- [x] GitHub Actions workflow
- [x] Testing documentation

---

## Contact

**Issues**: Para problemas con tests, abrir issue en GitHub

**Documentation**: `future-developments/testing/` contiene guías detalladas

**Coverage Reports**: Disponibles en Codecov (cuando se configure)
