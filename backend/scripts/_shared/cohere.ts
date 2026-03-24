/**
 * Lightweight Cohere Embed 4 client for operational scripts.
 *
 * Unlike the app's CohereEmbeddingService (which has Redis caching, usage tracking,
 * and logger integration), this is a minimal wrapper for one-time operations.
 */
import 'dotenv/config';

const MAX_BATCH_SIZE = 96;

/** Azure AIServices deployment name for Cohere Embed v4 */
const AZURE_DEPLOYMENT_NAME = 'embed-v-4-0';
const AZURE_API_VERSION = '2024-06-01';

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

interface AzureEmbedResponse {
  data: Array<{ index: number; embedding: number[] }>;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
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
  private readonly isAzureEndpoint: boolean;
  readonly modelName = 'Cohere-embed-v4';

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.isAzureEndpoint = endpoint.includes('.cognitiveservices.azure.com');
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
    let url: string;
    let headers: Record<string, string>;

    if (this.isAzureEndpoint) {
      const baseUrl = this.endpoint.endsWith('/') ? this.endpoint.slice(0, -1) : this.endpoint;
      url = `${baseUrl}/openai/deployments/${AZURE_DEPLOYMENT_NAME}/embeddings?api-version=${AZURE_API_VERSION}`;
      headers = { 'api-key': this.apiKey, 'Content-Type': 'application/json' };
    } else {
      url = `${this.endpoint}/v2/embed`;
      headers = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    }

    const requestBody = this.isAzureEndpoint ? this.transformForAzure(body) : body;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 429) {
        throw new Error(`Cohere rate limit exceeded (429). Wait and retry.`);
      }
      throw new Error(`Cohere API error ${response.status}: ${errorText}`);
    }

    if (this.isAzureEndpoint) {
      const azure = (await response.json()) as AzureEmbedResponse;
      const sorted = [...azure.data].sort((a, b) => a.index - b.index);
      return {
        id: `azure-${Date.now()}`,
        embeddings: { float: sorted.map((d) => d.embedding) },
        meta: { billed_units: { input_tokens: azure.usage?.prompt_tokens ?? 0 } },
      };
    }

    return (await response.json()) as CohereApiResponse;
  }

  private transformForAzure(body: Record<string, unknown>): Record<string, unknown> {
    const texts = body.texts as string[] | undefined;
    if (texts && texts.length > 0) {
      return { input: texts, model: AZURE_DEPLOYMENT_NAME };
    }
    const images = body.images as string[] | undefined;
    if (images && images.length > 0) {
      console.warn('Warning: Azure AIServices does not natively support image embedding via OpenAI API — sending as text fallback');
      return { input: images, model: AZURE_DEPLOYMENT_NAME };
    }
    return { input: [], model: AZURE_DEPLOYMENT_NAME };
  }
}
