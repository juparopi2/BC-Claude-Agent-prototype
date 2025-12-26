/**
 * Frontend Stores (Legacy)
 *
 * All stores have been migrated to the domain architecture:
 * - authStore -> src/domains/auth
 * - sessionStore -> src/domains/session
 * - uiPreferencesStore -> src/domains/ui
 * - chatStore -> src/domains/chat (messageStore, streamingStore, approvalStore, citationStore)
 * - fileStore -> src/domains/files
 *
 * This directory is kept for backwards compatibility.
 * Use the new domain imports instead.
 *
 * @module lib/stores
 * @deprecated Use @/src/domains/* instead
 */

// No exports - all stores have been migrated
