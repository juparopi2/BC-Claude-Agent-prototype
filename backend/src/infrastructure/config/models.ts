/**
 * Centralized Model Configuration
 *
 * This file defines all AI model configurations used across the application.
 * Models are organized by ROLE, not by name, allowing easy swapping and
 * cost optimization based on task requirements.
 *
 * CRITICAL CONSTRAINTS (Anthropic API):
 * 1. temperature + thinking cannot coexist
 *    - When thinking.type === 'enabled', do NOT set temperature field
 *    - ModelFactory handles this, but config should not create the conflict
 * 2. tool_choice: 'any' + thinking cannot coexist
 *    - When thinking.type === 'enabled', tool_choice MUST be 'auto'
 *    - Guarded in agent-builders.ts (throws if both are active)
 *    - Currently safe: only supervisor has thinking, workers have tools
 *
 * Role Summary:
 * | Role            | Thinking | Temperature |
 * |-----------------|----------|-------------|
 * | supervisor      | enabled  | omitted     |
 * | bc_agent        | disabled | 0.3         |
 * | rag_agent       | disabled | 0.5         |
 * | graphing_agent  | disabled | 0.2         |
 * | session_title   | disabled | 0.7         |
 *
 * @see backend/src/core/langchain/CLAUDE.md - Full domain documentation
 * @see backend/src/core/langchain/ModelFactory.ts - Factory implementation
 */

import type { ModelProvider } from '@/core/langchain/ModelFactory';

// =============================================================================
// ANTHROPIC MODEL IDENTIFIERS
// These are the official model IDs from Anthropic's API
// @see https://docs.anthropic.com/en/docs/about-claude/models
// =============================================================================

/**
 * Anthropic model identifiers.
 * Using const assertion for type safety while allowing string extensibility.
 */
export const AnthropicModels = {
  HAIKU_4_5: 'claude-haiku-4-5-20251001',
  HAIKU_3_5: 'claude-3-5-haiku-20241022',
} as const;

export type AnthropicModelId = (typeof AnthropicModels)[keyof typeof AnthropicModels];

// =============================================================================
// OPENAI MODEL IDENTIFIERS
// Fallback model for provider switching
// =============================================================================

/**
 * OpenAI model identifiers for fallback scenarios.
 */
export const OpenAIModels = {
  GPT_4O_MINI: 'gpt-4o-mini',
} as const;

export type OpenAIModelId = (typeof OpenAIModels)[keyof typeof OpenAIModels];

/**
 * Google/Vertex AI model identifiers for fallback scenarios.
 */
export const GoogleModels = {
  GEMINI_2_FLASH: 'gemini-2.0-flash',
} as const;

export type GoogleModelId = (typeof GoogleModels)[keyof typeof GoogleModels];

/**
 * Fallback model strings for provider switching.
 * Format: "provider:model-name" for initChatModel compatibility.
 */
export const FallbackModels = {
  OPENAI_GPT4O_MINI: `openai:${OpenAIModels.GPT_4O_MINI}`,
  GOOGLE_GEMINI_FLASH: `google:${GoogleModels.GEMINI_2_FLASH}`,
} as const;

// =============================================================================
// MODEL ROLES
// Define the purpose/role of each model usage in the system
// =============================================================================

/**
 * Model roles define the PURPOSE of the model, not the model itself.
 * This allows swapping models without changing business logic.
 */
export type ModelRole =
  | 'supervisor'      // Lightweight supervisor routing between agents
  | 'bc_agent'        // Business Central operations
  | 'rag_agent'       // RAG/Knowledge retrieval
  | 'graphing_agent'  // Data visualization and chart configuration
  | 'session_title';  // Generate session titles

/**
 * Extended model config with role metadata.
 */
/**
 * Anthropic extended thinking configuration.
 * When enabled, the model uses a "thinking" step before generating output.
 */
export type ThinkingConfig =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' };

export interface RoleModelConfig {
  role: ModelRole;
  description: string;
  /** Model string identifier (e.g., "claude-haiku-4-5-20251001") */
  modelString: string;
  /** Fallback model string for provider switching (e.g., "openai:gpt-4o-mini") */
  fallback?: string;
  provider: ModelProvider;
  modelName: string;
  temperature: number;
  maxTokens?: number;
  streaming?: boolean;
  /** Anthropic extended thinking configuration */
  thinking?: ThinkingConfig;
  /** Enable Anthropic prompt caching (adds beta header) */
  promptCaching?: boolean;
}

// =============================================================================
// ROLE-BASED MODEL CONFIGURATION
// =============================================================================

/**
 * Central configuration mapping roles to their model settings.
 * Change these to swap models across the entire application.
 */
export const ModelRoleConfigs: Record<ModelRole, RoleModelConfig> = {
  supervisor: {
    role: 'supervisor',
    description: 'Lightweight supervisor for routing between specialist agents',
    modelString: AnthropicModels.HAIKU_4_5,
    fallback: FallbackModels.OPENAI_GPT4O_MINI,
    provider: 'anthropic',
    modelName: AnthropicModels.HAIKU_4_5,
    temperature: 0.0, // Omitted at runtime when thinking is enabled (API→1.0)
    maxTokens: 16384, // Must be > budget_tokens when thinking is enabled
    streaming: true,
    thinking: { type: 'enabled', budget_tokens: 5000 }, // Safe: supervisor has no tool_choice
    promptCaching: true,
  },

  bc_agent: {
    role: 'bc_agent',
    description: 'Business Central operations and API interactions',
    modelString: AnthropicModels.HAIKU_4_5,
    fallback: FallbackModels.OPENAI_GPT4O_MINI,
    provider: 'anthropic',
    modelName: AnthropicModels.HAIKU_4_5,
    temperature: 0.3, // More deterministic for BC operations
    maxTokens: 32000,
    streaming: true,
    thinking: { type: 'disabled' }, // Disabled for now (can be enabled in future)
    promptCaching: true,
  },

  rag_agent: {
    role: 'rag_agent',
    description: 'RAG retrieval and knowledge synthesis',
    modelString: AnthropicModels.HAIKU_4_5,
    fallback: FallbackModels.OPENAI_GPT4O_MINI,
    provider: 'anthropic',
    modelName: AnthropicModels.HAIKU_4_5,
    temperature: 0.5,
    maxTokens: 16384,
    streaming: true,
    thinking: { type: 'disabled' }, // Disabled for now (can be enabled in future)
    promptCaching: true,
  },

  graphing_agent: {
    role: 'graphing_agent',
    description: 'Data visualization and chart configuration generation',
    modelString: AnthropicModels.HAIKU_4_5,
    fallback: FallbackModels.OPENAI_GPT4O_MINI,
    provider: 'anthropic',
    modelName: AnthropicModels.HAIKU_4_5,
    temperature: 0.2,
    maxTokens: 16384,
    streaming: true,
    thinking: { type: 'disabled' }, // Disabled for now (can be enabled in future)
    promptCaching: true,
  },

  session_title: {
    role: 'session_title',
    description: 'Generate concise session titles from conversation',
    modelString: AnthropicModels.HAIKU_3_5,
    fallback: FallbackModels.OPENAI_GPT4O_MINI,
    provider: 'anthropic',
    modelName: AnthropicModels.HAIKU_3_5,
    temperature: 0.7,
    maxTokens: 50,
    streaming: false,
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get model configuration by role.
 * @param role - The model role
 * @returns RoleModelConfig with all settings for the role
 */
export function getModelConfig(role: ModelRole): RoleModelConfig {
  const config = ModelRoleConfigs[role];
  if (!config) {
    throw new Error(`Unknown model role: ${role}`);
  }
  return config;
}

/**
 * Get model name by role (for quick access)
 */
export function getModelName(role: ModelRole): string {
  return ModelRoleConfigs[role].modelName;
}

// =============================================================================
// AZURE AI SERVICES CONFIGURATION
// Centralized configuration for Azure Vision, Document Intelligence, and Embeddings
// =============================================================================

/**
 * Azure OpenAI Embedding Models
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models
 */
export const AzureEmbeddingModels = {
  // Text Embedding Models
  TEXT_EMBEDDING_3_SMALL: 'text-embedding-3-small',  // 1536 dims, $0.02/1M tokens
  TEXT_EMBEDDING_3_LARGE: 'text-embedding-3-large',  // 3072 dims, $0.13/1M tokens
  TEXT_EMBEDDING_ADA_002: 'text-embedding-ada-002',  // 1536 dims, legacy
} as const;

export type AzureEmbeddingModelId = (typeof AzureEmbeddingModels)[keyof typeof AzureEmbeddingModels];

/**
 * Azure OpenAI Audio Transcription Models
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models#audio-models
 */
export const AzureAudioModels = {
  // GPT-4o Audio Models (2025)
  GPT_4O_TRANSCRIBE: 'gpt-4o-transcribe',           // High quality, $6/1M audio tokens
  GPT_4O_MINI_TRANSCRIBE: 'gpt-4o-mini-transcribe', // Cost-effective, $6/1M audio tokens
  // Whisper Models (Legacy)
  WHISPER_1: 'whisper-1',                           // $0.006/minute
} as const;

export type AzureAudioModelId = (typeof AzureAudioModels)[keyof typeof AzureAudioModels];

/**
 * Azure Computer Vision API Versions
 * Different versions have different capabilities for image understanding
 * @see https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/
 */
export const AzureVisionModels = {
  // Image Vectorization (Embeddings)
  VECTORIZE_2023_04_15: '2023-04-15',    // 1024 dims, standard
  VECTORIZE_2024_02_01: '2024-02-01',    // Latest stable, better semantic understanding
} as const;

export type AzureVisionModelId = (typeof AzureVisionModels)[keyof typeof AzureVisionModels];

/**
 * Azure Document Intelligence Models
 * @see https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/
 */
export const AzureDocumentModels = {
  // Prebuilt Models
  PREBUILT_READ: 'prebuilt-read',           // Basic OCR, text extraction
  PREBUILT_LAYOUT: 'prebuilt-layout',       // Tables, structure, selection marks
  PREBUILT_DOCUMENT: 'prebuilt-document',   // Key-value pairs, entities
  PREBUILT_INVOICE: 'prebuilt-invoice',     // Invoice-specific extraction
  PREBUILT_RECEIPT: 'prebuilt-receipt',     // Receipt-specific extraction
} as const;

export type AzureDocumentModelId = (typeof AzureDocumentModels)[keyof typeof AzureDocumentModels];

// =============================================================================
// AZURE AI SERVICE ROLES
// =============================================================================

/**
 * Azure service roles for different use cases
 */
export type AzureServiceRole =
  | 'text_embedding'        // Text to vector for semantic search
  | 'image_embedding'       // Image to vector for visual search
  | 'document_ocr'          // PDF/document text extraction
  | 'document_structure'    // Document layout and table extraction
  | 'audio_transcription';  // Speech-to-text transcription

/**
 * Azure service configuration with role metadata
 */
export interface AzureServiceConfig {
  role: AzureServiceRole;
  description: string;
  modelId: string;
  apiVersion: string;
  dimensions?: number;
  tier: 'free' | 'standard' | 'premium';
}

/**
 * Central configuration for Azure AI Services
 * Change these to swap models across the entire application
 */
export const AzureServiceConfigs: Record<AzureServiceRole, AzureServiceConfig> = {
  text_embedding: {
    role: 'text_embedding',
    description: 'Convert text queries to vectors for semantic search',
    modelId: AzureEmbeddingModels.TEXT_EMBEDDING_3_SMALL,
    apiVersion: '2024-06-01',
    dimensions: 1536,
    tier: 'standard',
  },

  image_embedding: {
    role: 'image_embedding',
    description: 'Convert images to vectors for visual similarity search',
    modelId: 'vectorize-image', // Azure Vision endpoint
    apiVersion: AzureVisionModels.VECTORIZE_2024_02_01,
    dimensions: 1024,
    tier: 'standard',
  },

  document_ocr: {
    role: 'document_ocr',
    description: 'Extract text from PDFs and scanned documents',
    modelId: AzureDocumentModels.PREBUILT_READ,
    apiVersion: '2024-02-29-preview',
    tier: 'standard',
  },

  document_structure: {
    role: 'document_structure',
    description: 'Extract tables, structure, and layout from documents',
    modelId: AzureDocumentModels.PREBUILT_LAYOUT,
    apiVersion: '2024-02-29-preview',
    tier: 'premium',
  },

  audio_transcription: {
    role: 'audio_transcription',
    description: 'Convert speech audio to text using Azure OpenAI',
    modelId: AzureAudioModels.GPT_4O_MINI_TRANSCRIBE,
    apiVersion: '2025-03-01-preview',
    tier: 'standard',
  },
};

/**
 * Get Azure service configuration by role
 */
export function getAzureServiceConfig(role: AzureServiceRole): AzureServiceConfig {
  const config = AzureServiceConfigs[role];
  if (!config) {
    throw new Error(`Unknown Azure service role: ${role}`);
  }
  return config;
}
