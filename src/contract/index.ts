/**
 * NEXUS AI — Phase 2 contract barrel.
 *
 * One import site for the seam: `import { ... } from '@/contract'`.
 * Screens that adopt Phase 2 wiring should use this barrel, not the files behind it,
 * so the contract stays a single addressable unit. Nothing consumes it yet.
 */

export * from './ipc';
export * from './client';
