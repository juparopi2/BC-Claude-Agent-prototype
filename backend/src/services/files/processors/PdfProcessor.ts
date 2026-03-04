/**
 * PDF Document Processor
 *
 * Thin wrapper around AzureDocIntelligenceProcessor for backwards compatibility.
 * PDF extraction uses Azure Document Intelligence (prebuilt-read model).
 *
 * @module services/files/processors/PdfProcessor
 */

import { AzureDocIntelligenceProcessor } from './AzureDocIntelligenceProcessor';

/**
 * PDF Document Processor
 *
 * Inherits all functionality from AzureDocIntelligenceProcessor.
 * Maintained as a separate class for backwards compatibility and clear
 * processor registry semantics.
 */
export class PdfProcessor extends AzureDocIntelligenceProcessor {}
