import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { INormalizedStreamEvent, ProviderType } from './INormalizedEvent';

/**
 * Interface that all provider stream adapters must implement.
 * An adapter is responsible for converting raw LangChain stream events
 * into normalized application events.
 */
export interface IStreamAdapter {
  readonly provider: ProviderType;

  /**
   * Processes a single chunk of data from the LLM stream.
   *
   * @param event - The raw stream event from LangChain
   * @returns The normalized event, or null if the event should be skipped/filtered
   */
  processChunk(event: StreamEvent): INormalizedStreamEvent | null;

  /**
   * Resets the internal state of the adapter.
   * Should be called when starting a new stream or retry.
   */
  reset(): void;

  /**
   * Gets the current block index tracking position in the stream.
   */
  getCurrentBlockIndex(): number;
}
