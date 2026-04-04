import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

// Register plugins once — GSAP is idempotent on re-registration
if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);
}

/**
 * Usage pattern for marketing animations:
 *
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useGSAP(() => {
 *     gsap.from('.hero-title', { opacity: 0, y: 40, duration: 0.8 });
 *   }, { scope: containerRef });
 *   return <div ref={containerRef}>...</div>;
 *
 * The scope parameter isolates selector queries to the container
 * and ensures automatic cleanup on unmount.
 */
export { gsap, useGSAP, ScrollTrigger, SplitText };
