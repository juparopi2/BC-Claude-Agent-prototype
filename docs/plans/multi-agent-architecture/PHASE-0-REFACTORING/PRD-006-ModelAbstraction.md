# PRD-006: Model Abstraction with initChatModel

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: Ninguna (puede comenzar inmediatamente)
**Bloquea**: Fase 1 (TDD Foundation), Fase 3 (Supervisor)
**Fase**: 0.5 (Pre-requisito para Multi-Agent)

---

## 1. Objetivo

Migrar de `ModelFactory` custom a `initChatModel()` nativo de LangChain para:
- **Multi-proveedor agnóstico**: Anthropic, OpenAI, Google, Azure con sintaxis unificada
- **Feature detection automática**: Via `model.profile` dinámico
- **Soporte multimodal**: Texto, imágenes, audio input/output
- **Runtime provider switching**: Cambiar proveedor sin cambiar código

---

## 2. Contexto

### 2.1 Estado Actual del Codebase

El análisis revela **alto acoplamiento a Anthropic**:

| Archivo | Problema |
|---------|----------|
| `models.ts` | Solo define modelos Anthropic en roles |
| `ModelFactory.ts` | Extended thinking, caching hardcodeados para Anthropic |
| `AnthropicAdapter.ts` | Único adapter implementado |
| `BatchResultNormalizer.ts` | Asume formato Anthropic |
| `EmbeddingService.ts` | Hardcodeado a Azure OpenAI |
| `IProviderAdapter.ts` | Interface custom para normalización |

### 2.2 Limitaciones del Enfoque Actual

1. **No hay abstracción de proveedor**: Agregar OpenAI/Google requiere código nuevo
2. **Feature detection manual**: Capabilities hardcodeadas en constantes
3. **Sin soporte audio**: No hay transcripción ni generación de audio
4. **Normalización custom**: 500+ líneas de código para adaptar respuestas

---

## 3. Solución Nativa de LangChain

### 3.1 `initChatModel()` - Sintaxis Unificada

```typescript
import { initChatModel } from "langchain";

// Sintaxis unificada: "provider:model" o inferido automáticamente
const anthropic = await initChatModel("claude-sonnet-4-5-20250929");
const openai = await initChatModel("openai:gpt-4.1");
const google = await initChatModel("google-genai:gemini-2.5-flash-lite");
const azure = await initChatModel("azure_openai:gpt-4.1");

// Con configuración
const model = await initChatModel("claude-haiku-4-5-20251001", {
  temperature: 0.3,
  maxTokens: 8192,
});
```

### 3.2 Feature Detection con `model.profile`

```typescript
const model = await initChatModel("claude-sonnet-4-5-20250929");

console.log(model.profile);
// {
//   maxInputTokens: 400000,
//   imageInputs: true,
//   reasoningOutput: true,  // Extended thinking (Claude)
//   toolCalling: true,
//   structuredOutput: true,
//   ...
// }

// Uso condicional
if (model.profile?.reasoningOutput) {
  // Habilitar extended thinking
}
```

### 3.3 Runtime Provider Switching

```typescript
import { z } from "zod";

const ConfigSchema = z.object({
  modelProvider: z.enum(["anthropic", "openai", "google"]).default("anthropic"),
});

// En el grafo
const node = async (state, config) => {
  const provider = config?.configurable?.modelProvider || "anthropic";
  const model = await initChatModel(
    provider === "anthropic" ? "claude-sonnet-4-5-20250929" :
    provider === "openai" ? "openai:gpt-4.1" :
    "google-genai:gemini-2.5-flash-lite"
  );

  return model.invoke(state.messages);
};

// Invocación con provider específico
await graph.invoke(input, { configurable: { modelProvider: "openai" } });
```

---

## 4. Diseño Propuesto

### 4.1 Nuevo `models.ts`

```typescript
import { initChatModel, type BaseChatModel } from "langchain";

// ===========================================
// MODEL ROLES - Simplified configuration
// ===========================================

export type ModelRole =
  | "orchestrator"    // Main conversation
  | "router"          // Fast routing decisions
  | "bc_agent"        // Business Central expert
  | "rag_agent"       // RAG/Knowledge search
  | "graph_agent"     // Data visualization
  | "audio_transcription"  // Whisper
  | "audio_generation";    // Audio output

interface RoleConfig {
  /** Model string: "model" (Anthropic default) or "provider:model" */
  modelString: string;
  /** Fallback model for different provider */
  fallback?: string;
  /** Temperature for generation */
  temperature: number;
  /** Max output tokens */
  maxTokens: number;
  /** Modalities for audio models */
  modalities?: ("text" | "audio")[];
  /** Audio config for TTS */
  audio?: { voice: string; format: string };
  /** Features required */
  requiredFeatures?: ("toolCalling" | "imageInputs" | "reasoningOutput")[];
}

export const ModelRoleConfigs: Record<ModelRole, RoleConfig> = {
  orchestrator: {
    modelString: "claude-sonnet-4-5-20250929",
    fallback: "openai:gpt-4o",
    temperature: 0.7,
    maxTokens: 32000,
    requiredFeatures: ["toolCalling"],
  },
  router: {
    modelString: "claude-haiku-4-5-20251001",
    fallback: "openai:gpt-4o-mini",
    temperature: 0.0,
    maxTokens: 512,
  },
  bc_agent: {
    modelString: "claude-haiku-4-5-20251001",
    fallback: "openai:gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 32000,
    requiredFeatures: ["toolCalling"],
  },
  rag_agent: {
    modelString: "claude-sonnet-4-5-20250929",
    fallback: "openai:gpt-4o",
    temperature: 0.2,
    maxTokens: 16000,
  },
  graph_agent: {
    modelString: "claude-sonnet-4-5-20250929",
    fallback: "openai:gpt-4o",
    temperature: 0.5,
    maxTokens: 8000,
  },
  audio_transcription: {
    modelString: "openai:whisper-1",
    temperature: 0,
    maxTokens: 0, // Not applicable
  },
  audio_generation: {
    modelString: "openai:gpt-4o-audio-preview",
    temperature: 0.7,
    maxTokens: 4096,
    modalities: ["text", "audio"],
    audio: { voice: "alloy", format: "wav" },
  },
};
```

### 4.2 Nuevo `ModelFactory.ts` (Simplificado)

```typescript
import { initChatModel, type BaseChatModel } from "langchain";
import { ModelRoleConfigs, type ModelRole } from "./models";
import { createChildLogger } from "@/shared/utils/logger";

const logger = createChildLogger({ service: "ModelFactory" });

/**
 * ModelFactory - Simplified wrapper over initChatModel
 *
 * Provides:
 * - Role-based model selection
 * - Caching of model instances
 * - Runtime provider switching
 * - Feature detection
 */
export class ModelFactory {
  private static cache = new Map<string, BaseChatModel>();

  /**
   * Get model for a specific role
   */
  static async create(role: ModelRole): Promise<BaseChatModel> {
    const config = ModelRoleConfigs[role];
    const cacheKey = `${role}:${config.modelString}`;

    if (!this.cache.has(cacheKey)) {
      const model = await initChatModel(config.modelString, {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        ...(config.modalities && { modalities: config.modalities }),
        ...(config.audio && { audio: config.audio }),
      });

      // Validate required features
      if (config.requiredFeatures?.length) {
        await this.validateFeatures(model, config.requiredFeatures, role);
      }

      this.cache.set(cacheKey, model);
      logger.info({ role, model: config.modelString }, "Model initialized");
    }

    return this.cache.get(cacheKey)!;
  }

  /**
   * Create model with specific provider override
   */
  static async createWithProvider(
    role: ModelRole,
    provider: "anthropic" | "openai" | "google"
  ): Promise<BaseChatModel> {
    const config = ModelRoleConfigs[role];

    // Use fallback for non-Anthropic providers
    const modelString = provider === "anthropic"
      ? config.modelString
      : config.fallback ?? `${provider}:gpt-4o-mini`;

    const cacheKey = `${role}:${provider}:${modelString}`;

    if (!this.cache.has(cacheKey)) {
      const model = await initChatModel(modelString, {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
      this.cache.set(cacheKey, model);
    }

    return this.cache.get(cacheKey)!;
  }

  /**
   * Check if model supports a feature
   */
  static async supportsFeature(
    role: ModelRole,
    feature: "toolCalling" | "imageInputs" | "reasoningOutput" | "structuredOutput"
  ): Promise<boolean> {
    const model = await this.create(role);
    return model.profile?.[feature] ?? false;
  }

  /**
   * Get model profile for a role
   */
  static async getProfile(role: ModelRole): Promise<Record<string, unknown> | undefined> {
    const model = await this.create(role);
    return model.profile;
  }

  /**
   * Clear cache (for testing)
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Validate required features
   */
  private static async validateFeatures(
    model: BaseChatModel,
    features: string[],
    role: ModelRole
  ): Promise<void> {
    for (const feature of features) {
      if (model.profile && !model.profile[feature]) {
        logger.warn(
          { role, feature, model: model.getName() },
          "Model missing required feature"
        );
      }
    }
  }
}

// Convenience function
export async function getModelForRole(role: ModelRole): Promise<BaseChatModel> {
  return ModelFactory.create(role);
}
```

### 4.3 Audio Services

#### `AudioTranscriptionService.ts`

```typescript
import { OpenAIWhisperAudio } from "@langchain/community/document_loaders/fs/openai_whisper_audio";
import { createChildLogger } from "@/shared/utils/logger";

const logger = createChildLogger({ service: "AudioTranscriptionService" });

export interface TranscriptionOptions {
  language?: string;  // ISO 639-1 code
  prompt?: string;    // Context for better accuracy
}

/**
 * Transcribe audio files using OpenAI Whisper
 */
export class AudioTranscriptionService {
  /**
   * Transcribe audio file to text
   */
  async transcribe(
    audioPath: string,
    options?: TranscriptionOptions
  ): Promise<string> {
    logger.info({ audioPath, language: options?.language }, "Starting transcription");

    const loader = new OpenAIWhisperAudio(audioPath, {
      transcriptionCreateParams: {
        language: options?.language,
        prompt: options?.prompt,
      },
    });

    const docs = await loader.load();
    const transcript = docs.map(d => d.pageContent).join("\n");

    logger.info({
      audioPath,
      transcriptLength: transcript.length
    }, "Transcription complete");

    return transcript;
  }

  /**
   * Transcribe from base64 audio data
   */
  async transcribeBase64(
    base64Audio: string,
    format: "wav" | "mp3" | "m4a" = "wav",
    options?: TranscriptionOptions
  ): Promise<string> {
    // Write to temp file and transcribe
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const tempPath = path.join(os.tmpdir(), `audio-${Date.now()}.${format}`);
    await fs.writeFile(tempPath, Buffer.from(base64Audio, "base64"));

    try {
      return await this.transcribe(tempPath, options);
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}

// Singleton
let transcriptionService: AudioTranscriptionService | null = null;

export function getAudioTranscriptionService(): AudioTranscriptionService {
  if (!transcriptionService) {
    transcriptionService = new AudioTranscriptionService();
  }
  return transcriptionService;
}
```

#### `AudioGenerationService.ts`

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { createChildLogger } from "@/shared/utils/logger";

const logger = createChildLogger({ service: "AudioGenerationService" });

export interface AudioConfig {
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  format: "wav" | "mp3" | "flac" | "opus" | "pcm16";
}

export interface AudioResponse {
  transcript: string;
  audioData: string;  // Base64 encoded
  format: string;
}

/**
 * Generate audio responses using GPT-4o Audio
 */
export class AudioGenerationService {
  private model: ChatOpenAI;

  constructor(config?: Partial<AudioConfig>) {
    this.model = new ChatOpenAI({
      model: "gpt-4o-audio-preview",
      modalities: ["text", "audio"],
      audio: {
        voice: config?.voice ?? "alloy",
        format: config?.format ?? "wav",
      },
    });
  }

  /**
   * Generate audio response from text
   */
  async generateAudio(text: string): Promise<AudioResponse> {
    logger.info({ textLength: text.length }, "Generating audio response");

    const result = await this.model.invoke(text);
    const audio = result.additional_kwargs.audio as Record<string, unknown>;

    logger.info({
      transcriptLength: (audio.transcript as string).length
    }, "Audio generated");

    return {
      transcript: audio.transcript as string,
      audioData: audio.data as string,
      format: "wav",
    };
  }

  /**
   * Process audio input and get audio response
   */
  async processAudioInput(
    audioBase64: string,
    format: "wav" | "mp3" = "wav"
  ): Promise<AudioResponse> {
    logger.info({ format }, "Processing audio input");

    const message = new HumanMessage({
      content: [{
        type: "input_audio",
        input_audio: {
          data: audioBase64,
          format
        },
      }],
    });

    const result = await this.model.invoke([message]);
    const audio = result.additional_kwargs.audio as Record<string, unknown>;

    return {
      transcript: audio.transcript as string,
      audioData: audio.data as string,
      format: "wav",
    };
  }

  /**
   * Voice-to-voice conversation
   */
  async voiceConversation(
    audioBase64: string,
    systemPrompt?: string
  ): Promise<AudioResponse> {
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    messages.push(new HumanMessage({
      content: [{
        type: "input_audio",
        input_audio: { data: audioBase64, format: "wav" },
      }],
    }));

    const result = await this.model.invoke(messages);
    const audio = result.additional_kwargs.audio as Record<string, unknown>;

    return {
      transcript: audio.transcript as string,
      audioData: audio.data as string,
      format: "wav",
    };
  }
}

// Singleton
let audioService: AudioGenerationService | null = null;

export function getAudioGenerationService(
  config?: Partial<AudioConfig>
): AudioGenerationService {
  if (!audioService) {
    audioService = new AudioGenerationService(config);
  }
  return audioService;
}
```

### 4.4 Image Input Support

```typescript
import { HumanMessage } from "@langchain/core/messages";
import { ModelFactory } from "./ModelFactory";

/**
 * Create message with image content
 */
export function createImageMessage(
  text: string,
  imageUrl: string
): HumanMessage {
  return new HumanMessage({
    content: [
      { type: "text", text },
      { type: "image_url", image_url: { url: imageUrl } },
    ],
  });
}

/**
 * Create message with base64 image
 */
export function createBase64ImageMessage(
  text: string,
  base64Image: string,
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/png"
): HumanMessage {
  return new HumanMessage({
    content: [
      { type: "text", text },
      {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64Image}`
        }
      },
    ],
  });
}

/**
 * Check if role supports image input
 */
export async function supportsImageInput(role: ModelRole): Promise<boolean> {
  return ModelFactory.supportsFeature(role, "imageInputs");
}
```

---

## 5. Archivos a Modificar/Eliminar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `backend/src/shared/models/models.ts` | **REESCRIBIR** | Simplificar a role configs |
| `backend/src/shared/models/ModelFactory.ts` | **REESCRIBIR** | Wrapper sobre initChatModel |
| `backend/src/shared/providers/AnthropicAdapter.ts` | **ELIMINAR** | LangChain normaliza internamente |
| `backend/src/shared/providers/IProviderAdapter.ts` | **ELIMINAR** | Ya no necesario |
| `backend/src/shared/providers/index.ts` | **ELIMINAR** | Folder completo |
| `backend/src/domains/agent/BatchResultNormalizer.ts` | **SIMPLIFICAR** | Usar output estándar |
| `backend/src/modules/agents/business-central/bc-agent.ts` | **ACTUALIZAR** | Usar nuevo ModelFactory |
| `backend/src/modules/agents/rag-knowledge/rag-agent.ts` | **ACTUALIZAR** | Usar nuevo ModelFactory |

### Nuevos Archivos a Crear

```
backend/src/shared/models/
├── models.ts                    # Role configs (reescrito)
├── ModelFactory.ts              # Simplified factory (reescrito)
├── index.ts                     # Exports

backend/src/services/audio/
├── AudioTranscriptionService.ts # Whisper integration
├── AudioGenerationService.ts    # GPT-4o audio
├── index.ts

backend/src/shared/utils/
├── multimodal.ts                # Image message helpers
```

---

## 6. Plan de Migración

### Paso 1: Crear Nueva Infraestructura (TDD)
1. Crear `models.ts` con nuevas configs
2. Crear `ModelFactory.ts` wrapper
3. Crear tests unitarios
4. Verificar `npm run verify:types`

### Paso 2: Crear Audio Services
1. Implementar `AudioTranscriptionService`
2. Implementar `AudioGenerationService`
3. Tests de integración con OpenAI

### Paso 3: Migrar Agentes
1. Actualizar `bc-agent.ts` para usar nuevo factory
2. Actualizar `rag-agent.ts`
3. Verificar funcionalidad existente

### Paso 4: Eliminar Código Legacy
1. Eliminar `AnthropicAdapter.ts`
2. Eliminar `IProviderAdapter.ts`
3. Simplificar `BatchResultNormalizer.ts`
4. Cleanup imports

### Paso 5: Verificación Final
1. Ejecutar todos los tests
2. Verificar LangSmith traces
3. Documentar cambios en CLAUDE.md

---

## 7. Tests Requeridos

### 7.1 ModelFactory Tests

```typescript
describe("ModelFactory", () => {
  describe("create", () => {
    it("creates model for orchestrator role");
    it("creates model for router role");
    it("caches model instances");
    it("validates required features");
  });

  describe("createWithProvider", () => {
    it("creates Anthropic model");
    it("creates OpenAI model");
    it("uses fallback for non-Anthropic");
  });

  describe("supportsFeature", () => {
    it("detects toolCalling support");
    it("detects imageInputs support");
    it("detects reasoningOutput support");
  });
});
```

### 7.2 Audio Services Tests

```typescript
describe("AudioTranscriptionService", () => {
  it("transcribes audio file");
  it("transcribes base64 audio");
  it("handles different languages");
});

describe("AudioGenerationService", () => {
  it("generates audio from text");
  it("processes audio input");
  it("supports voice conversation");
});
```

---

## 8. Criterios de Aceptación

- [ ] `initChatModel()` funciona para todos los roles existentes
- [ ] `model.profile` detecta capacidades correctamente
- [ ] Runtime provider switching funciona (anthropic <-> openai)
- [ ] Audio transcription con Whisper funciona
- [ ] Audio generation con gpt-4o-audio-preview funciona
- [ ] Image inputs funcionan con content blocks
- [ ] Tests unitarios para nuevo ModelFactory
- [ ] AnthropicAdapter eliminado sin romper funcionalidad
- [ ] `npm run verify:types` pasa sin errores
- [ ] LangSmith traces muestran modelos correctos

---

## 9. Dependencias npm

```bash
# Core LangChain (verificar versión >= 0.3)
npm install langchain@latest
npm install @langchain/core@latest
npm install @langchain/anthropic@latest
npm install @langchain/openai@latest
npm install @langchain/google-genai@latest

# Audio support (Whisper loader)
npm install @langchain/community
```

---

## 10. Verificación Pre-Implementación

### Checklist

- [ ] Verificar que `initChatModel` soporta Anthropic extended thinking
- [ ] Verificar que `initChatModel` soporta prompt caching de Anthropic
- [ ] Confirmar que `model.profile` está disponible en versión actual de LangChain.js
- [ ] Validar que `OpenAIWhisperAudio` funciona con archivos locales
- [ ] Testear `gpt-4o-audio-preview` con audio input/output

### POC Script

```typescript
// scripts/test-model-abstraction.ts
import { initChatModel } from "langchain";

async function testModelAbstraction() {
  // Test Anthropic
  const claude = await initChatModel("claude-sonnet-4-5-20250929");
  console.log("Claude profile:", claude.profile);

  // Test OpenAI
  const gpt = await initChatModel("openai:gpt-4o");
  console.log("GPT profile:", gpt.profile);

  // Test feature detection
  console.log("Claude reasoning:", claude.profile?.reasoningOutput);
  console.log("GPT tools:", gpt.profile?.toolCalling);
}

testModelAbstraction().catch(console.error);
```

---

## 11. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| `initChatModel` no soporta beta features | Media | Alto | Mantener ChatAnthropic directo para extended thinking |
| Audio APIs requieren OpenAI key | Baja | Medio | Documentar requisito en setup |
| profile no disponible en versión actual | Baja | Medio | Fallback a capabilities hardcodeadas |
| Performance de cache | Baja | Bajo | LRU cache con límite |

---

## 12. Estimación

- **Desarrollo**: 4-5 días
- **Testing**: 2-3 días
- **Migración agentes**: 1-2 días
- **Cleanup legacy**: 1 día
- **Total**: 8-11 días

---

## 13. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Draft inicial |
