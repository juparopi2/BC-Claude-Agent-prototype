/**
 * Lightweight Cohere Embed 4 client for operational scripts.
 *
 * Unlike the app's CohereEmbeddingService (which has Redis caching, usage tracking,
 * and logger integration), this is a minimal wrapper for one-time operations.
 */
import 'dotenv/config';

const MAX_BATCH_SIZE = 96;

export interface CohereEmbedResult {
  embedding: number[];
  model: string;
  inputTokens: number;
}

interface CohereApiResponse {
  id: string;
  embeddings: { float: number[][] };
  meta?: { billed_units?: { input_tokens?: number } };
}

/**
 * Create a Cohere embedding client. Returns null if credentials not set.
 */
export function createCohereClient(): CohereClient | null {
  const endpoint = process.env.COHERE_ENDPOINT;
  const apiKey = process.env.COHERE_API_KEY;
  if (!endpoint || !apiKey) {
    console.warn('Warning: COHERE_ENDPOINT or COHERE_API_KEY not set');
    return null;
  }
  return new CohereClient(endpoint, apiKey);
}

export class CohereClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  readonly modelName = 'Cohere-embed-v4';

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  /** Embed a single text */
  async embedText(text: string, inputType: 'search_document' | 'search_query'): Promise<CohereEmbedResult> {
    const response = await this.callApi({
      texts: [text],
      input_type: inputType,
      embedding_types: ['float'],
      truncate: 'END',
    });
    const embedding = response.embeddings.float[0];
    if (!embedding) throw new Error('No embedding returned');
    return {
      embedding,
      model: this.modelName,
      inputTokens: response.meta?.billed_units?.input_tokens ?? 0,
    };
  }

  /** Embed an image from base64 data */
  async embedImage(imageBase64: string, inputType: 'search_document' | 'search_query'): Promise<CohereEmbedResult> {
    const imageWithPrefix = imageBase64.startsWith('data:image/')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;
    const response = await this.callApi({
      images: [imageWithPrefix],
      input_type: inputType,
      embedding_types: ['float'],
      truncate: 'END',
    });
    const embedding = response.embeddings.float[0];
    if (!embedding) throw new Error('No embedding returned for image');
    return {
      embedding,
      model: this.modelName,
      inputTokens: response.meta?.billed_units?.input_tokens ?? 0,
    };
  }

  /** Batch embed texts (auto-chunks into groups of 96) */
  async embedTextBatch(texts: string[], inputType: 'search_document' | 'search_query'): Promise<CohereEmbedResult[]> {
    const allResults: CohereEmbedResult[] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + MAX_BATCH_SIZE);
      const response = await this.callApi({
        texts: batch,
        input_type: inputType,
        embedding_types: ['float'],
        truncate: 'END',
      });
      const batchTokens = response.meta?.billed_units?.input_tokens ?? 0;
      const tokensPerItem = batch.length > 0 ? Math.ceil(batchTokens / batch.length) : 0;
      for (const embedding of response.embeddings.float) {
        allResults.push({ embedding, model: this.modelName, inputTokens: tokensPerItem });
      }
    }
    return allResults;
  }

  private async callApi(body: Record<string, unknown>): Promise<CohereApiResponse> {
    const response = await fetch(`${this.endpoint}/v2/embed`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 429) {
        throw new Error(`Cohere rate limit exceeded (429). Wait and retry.`);
      }
      throw new Error(`Cohere API error ${response.status}: ${errorText}`);
    }
    return (await response.json()) as CohereApiResponse;
  }
}
