/**
 * Shared Azure service client factories for backend scripts.
 *
 * Centralizes connection setup for Blob Storage and AI Search
 * that was previously duplicated across 10+ scripts.
 *
 * Usage:
 *   import { createBlobContainerClient, createSearchClient, createSearchIndexClient } from './_shared/azure';
 */
import 'dotenv/config';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';

// Default names (overridable via env vars)
export const CONTAINER_NAME = process.env.STORAGE_CONTAINER_NAME || 'user-files';
export const INDEX_NAME = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';

/**
 * Create Blob Storage container client. Returns null if connection string is not set.
 */
export function createBlobContainerClient(): ContainerClient | null {
  const connectionString = process.env.STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    console.warn('Warning: STORAGE_CONNECTION_STRING not set, skipping blob operations');
    return null;
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(CONTAINER_NAME);
}

/**
 * Create AI Search client for document operations. Returns null if credentials not set.
 */
export function createSearchClient<T extends object>(): SearchClient<T> | null {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const key = process.env.AZURE_SEARCH_KEY;
  if (!endpoint || !key) {
    console.warn('Warning: AI Search credentials not set, skipping search operations');
    return null;
  }
  return new SearchClient<T>(endpoint, INDEX_NAME, new AzureKeyCredential(key));
}

/**
 * Create AI Search index client for schema operations. Returns null if credentials not set.
 */
export function createSearchIndexClient(): SearchIndexClient | null {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const key = process.env.AZURE_SEARCH_KEY;
  if (!endpoint || !key) {
    console.warn('Warning: AI Search credentials not set, skipping index operations');
    return null;
  }
  return new SearchIndexClient(endpoint, new AzureKeyCredential(key));
}
