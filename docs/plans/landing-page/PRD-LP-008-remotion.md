# PRD-LP-008: Remotion Pipeline (Deferred)

**Estado**: Diferido — Fase 3
**Fase**: 3 (Deferred)
**Dependencias**: LP-003 (hero section built)
**Bloquea**: LP-009 (interactive demo)

---

## 1. Objetivo

Establecer la infraestructura de Remotion para crear videos programáticos en React. Usado para demos de producto, marketing campaigns, y contenido embebido en la landing page.

**Este PRD se DOCUMENTA ahora pero se IMPLEMENTA después de la Fase 2.**

---

## 2. Casos de Uso

### 2.1 Product Demo Videos
Videos cortos mostrando la interfaz del producto en acción:
- Chat con agente BC consultando facturas
- Upload de documentos + búsqueda semántica
- Data visualization generándose en tiempo real
- Multi-agent orchestration en acción

### 2.2 Marketing Campaign Videos
Videos para redes sociales, ads, o emails:
- "Meet Your AI Team" — presentación de cada agente
- "How It Works" — flujo de 30 segundos
- Feature announcements

### 2.3 Embedded Player
`<Player>` de Remotion embebido en la landing page para demos interactivos que el usuario puede pausar/rebobinar.

---

## 3. Herramientas Complementarias

### Kite (Screenshot-based videos)
- Captura screenshots del producto real
- Crea transiciones animadas entre screenshots
- Más rápido que grabar videos manualmente
- Output: frames o video que Remotion puede consumir

### Pipeline propuesto
```
Screenshots (manual o Kite)
    ↓
Remotion Compositions (React)
    ↓
┌──────────────────────┐
│ <Player> embebido    │ ← Landing page
│ MP4 export           │ ← Social media / ads
│ GIF export           │ ← Emails / docs
└──────────────────────┘
```

---

## 4. Setup Técnico (Para cuando se implemente)

### 4.1 Instalación
```bash
npm install -w bc-agent-frontend remotion @remotion/player @remotion/cli
```

### 4.2 Estructura
```
frontend/src/domains/marketing/remotion/
├── compositions/
│   ├── ProductDemo.tsx        ← Demo principal del producto
│   ├── AgentIntro.tsx         ← Presentación de agentes
│   └── FeatureHighlight.tsx   ← Highlight de feature individual
├── components/
│   ├── MockUI.tsx             ← UI mockup del producto
│   ├── ChatBubble.tsx         ← Burbuja de chat animada
│   └── AgentBadge.tsx         ← Badge de agente con color
├── Root.tsx                   ← Remotion root (composiciones)
└── index.ts                   ← Entry point
```

### 4.3 Player Integration
```typescript
import { Player } from '@remotion/player';
import { ProductDemo } from '@/domains/marketing/remotion/compositions/ProductDemo';

export function DemoPlayer() {
  return (
    <Player
      component={ProductDemo}
      durationInFrames={300}  // 10s at 30fps
      compositionWidth={1920}
      compositionHeight={1080}
      fps={30}
      controls
      loop
      style={{ width: '100%' }}
    />
  );
}
```

---

## 5. Estimación

- Setup + primer video: 3-5 días
- Cada video adicional: 1-2 días
- Player integration: 0.5 días

---

## 6. Criterios de Aceptación (para cuando se implemente)

- [ ] Remotion installed and configured
- [ ] At least 1 composition renders correctly in Remotion Studio
- [ ] `<Player>` embeds in landing page without layout issues
- [ ] MP4 export works via CLI
- [ ] Compositions use product branding (colors, fonts, agent colors)
