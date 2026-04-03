# PRD-LP-007: Chameleon Animation

**Estado**: Pendiente
**Fase**: 2 (Polish & Enhancement)
**Dependencias**: LP-006 (scroll animations), assets del camaleón (imagen + video)
**Bloquea**: Ninguno

---

## 1. Objetivo

Integrar la mascota del camaleón robótico como elemento interactivo vinculado al scroll. El camaleón cambia de color según la sección/agente visible, creando una conexión visual entre la identidad de marca y los agentes del producto.

---

## 2. Pre-requisitos (Assets)

Antes de implementar, se necesitan:

1. **Imagen definitiva del camaleón** (Nano Banana Pro 2)
   - Estilo: robótico/futurista
   - Fondo transparente (PNG o WebP)
   - Resolución mínima: 2048px para retina
   
2. **Video del camaleón** (VO3 / Higsfield)
   - Secuencia: camaleón camina + ilumina en colores de agentes + transición multicolor
   - Duración: 5-15 segundos
   - Resolución: 1080p mínimo
   
3. **Frame extraction**
   ```bash
   # Extraer frames del video
   ffmpeg -i chameleon-animation.mp4 -vf "fps=30" frames/frame_%04d.png
   
   # Optimizar a WebP
   for f in frames/*.png; do
     cwebp -q 85 "$f" -o "${f%.png}.webp"
   done
   ```
   
4. **Sprite sheet** (alternativa a frames individuales para mejor performance):
   ```bash
   # Generar sprite sheet con ImageMagick
   montage frames/*.webp -tile 10x -geometry +0+0 sprite-sheet.webp
   ```

---

## 3. Implementación Técnica

### 3.1 Opción A: Canvas Frame-by-Frame (Recomendada)

```typescript
// ChameleonCanvas.tsx
'use client';

import { useRef, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, ScrollTrigger } from '../animations/gsap-config';

const FRAME_COUNT = 150; // Adjust based on extracted frames

export function ChameleonCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const currentFrameRef = useRef({ value: 0 });

  useEffect(() => {
    // Preload all frames
    const frames = Array.from({ length: FRAME_COUNT }, (_, i) => {
      const img = new Image();
      img.src = `/marketing/chameleon/frame_${String(i).padStart(4, '0')}.webp`;
      return img;
    });
    framesRef.current = frames;
  }, []);

  useGSAP(() => {
    gsap.to(currentFrameRef.current, {
      value: FRAME_COUNT - 1,
      snap: 'value',
      ease: 'none',
      scrollTrigger: {
        trigger: '#chameleon-section',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.5,
        pin: true,
      },
      onUpdate: () => {
        const ctx = canvasRef.current?.getContext('2d');
        const frame = framesRef.current[Math.round(currentFrameRef.current.value)];
        if (ctx && frame?.complete) {
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
      },
    });
  });

  return (
    <canvas
      ref={canvasRef}
      width={1920}
      height={1080}
      className="w-full h-auto"
    />
  );
}
```

### 3.2 Opción B: img src Swap

Más simple, menos performance. Swap el `src` de un `<img>` según el scroll position. Viable si hay pocos frames (<50).

### 3.3 Color Synchronization

El camaleón cambia de color en sincronía con las secciones de agentes:

```typescript
const agentColorSequence = [
  { section: '#features-erp', color: '#3B82F6' },      // BC blue
  { section: '#features-knowledge', color: '#10B981' }, // RAG green
  { section: '#features-orchestration', color: '#8B5CF6' }, // Supervisor violet
  { section: '#features-viz', color: '#F59E0B' },       // Graphing amber
  { section: '#features-research', color: '#6366F1' },  // Research indigo
];

// GSAP ScrollTrigger for each section
agentColorSequence.forEach(({ section, color }) => {
  ScrollTrigger.create({
    trigger: section,
    start: 'top center',
    end: 'bottom center',
    onEnter: () => gsap.to('.chameleon-glow', { 
      backgroundColor: color, 
      duration: 0.8 
    }),
    onEnterBack: () => gsap.to('.chameleon-glow', { 
      backgroundColor: color, 
      duration: 0.8 
    }),
  });
});
```

---

## 4. Placement

### Opción A: Floating Element
El camaleón "flota" en una posición fija (sticky) a un lado de la pantalla y cambia de color mientras el usuario hace scroll. Desaparece después de la sección de agentes.

### Opción B: Dedicated Section
Una sección completa dedicada al camaleón donde el scroll controla la animación frame-by-frame (pinned). El usuario hace scroll para "reproducir" la animación.

### Opción C: Hero Integration
El camaleón vive en el espacio reservado del hero (HeroVisual placeholder de LP-003) y se anima con el scroll saliente del hero.

**Decisión**: Se define durante implementación basándose en los assets reales y cómo se ven en pantalla.

---

## 5. Fallback

Si los assets del camaleón no están listos:
- Mantener el placeholder del hero (LP-003)
- La sección funciona sin el camaleón
- Assets se integran cuando estén disponibles sin cambios de layout

---

## 6. Performance

- **Frame preloading**: Usar `IntersectionObserver` para precargar frames antes de que la sección sea visible
- **WebP format**: 60-80% menor que PNG con calidad visual equivalente
- **Sprite sheet**: Preferido sobre frames individuales — un solo archivo, un solo request, crop via canvas
- **Memory**: CUIDADO — cada frame decodificado a RGBA ocupa ~8MB a 1920x1080. 150 frames = ~1.2GB. **Resolución**: usar 960x540 (~2MB/frame) y limitar a 60-80 frames (~120-160MB). Retina via CSS upscale.
- **Mobile**: Imagen estática con CSS color overlay animado via GSAP (no canvas, no frames)
- **Progressive loading**: Cargar frames en chunks de 20, no todos a la vez

---

## 7. Criterios de Aceptación

- [ ] Camaleón se anima frame-by-frame vinculado al scroll
- [ ] Color cambia sincronizado con las secciones de agentes
- [ ] Transición multicolor al final de la secuencia
- [ ] Fallback funcional si assets no están disponibles
- [ ] Performance: no jank en scroll (60fps desktop)
- [ ] Responsive: adaptado o alternativa para mobile
- [ ] Frames precargados antes de ser necesarios

---

## 8. Archivos

```
frontend/src/domains/marketing/components/chameleon/
├── ChameleonSection.tsx       ← Container
├── ChameleonCanvas.tsx        ← Canvas renderer
└── ChameleonColorSync.tsx     ← Color synchronization logic

frontend/src/domains/marketing/animations/
└── chameleon-scroll.ts        ← GSAP ScrollTrigger config

frontend/public/marketing/chameleon/
├── frame_0000.webp            ← Extracted frames
├── frame_0001.webp
├── ...
└── frame_0149.webp
```
