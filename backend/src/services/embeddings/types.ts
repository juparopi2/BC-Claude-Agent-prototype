export interface TextEmbedding {
  embedding: number[];
  model: string;
  tokenCount: number;
  userId: string;
  createdAt: Date;
  raw?: unknown; // Official SDK type reference
}

export interface ImageEmbedding {
  embedding: number[];
  model: string;
  imageSize: number;
  userId: string;
  createdAt: Date;
}

export interface EmbeddingConfig {
  endpoint: string;
  apiKey: string;
  deploymentName: string;
  visionEndpoint?: string;
  visionKey?: string;
}
