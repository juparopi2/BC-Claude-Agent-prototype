
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { getSemanticSearchService } from '@/services/search/semantic';

/**
 * Creates a knowledge retrieval tool bound to a specific user context.
 * 
 * @param userId - The ID of the user performing the search
 */
export const createKnowledgeSearchTool = (userId: string) => {
  return tool(
    async ({ query }) => {
      try {
        const searchService = getSemanticSearchService();
        const results = await searchService.searchRelevantFiles({
          userId: userId,
          query: query,
          maxFiles: 5,
          threshold: 0.6 // Slightly lower threshold for broader recall
        });

        if (results.results.length === 0) {
            return "No relevant documents found in the knowledge base.";
        }

        // Format results for the agent
        const formattedResults = results.results.map(r => 
            `[Source: ${r.fileName} (Score: ${r.relevanceScore.toFixed(2)})]\n${r.content}`
        ).join("\n\n---\n\n");

        return `Found ${results.results.length} relevant documents:\n\n${formattedResults}`;

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error searching knowledge base: ${message}`;
      }
    },
    {
      name: 'search_knowledge_base',
      description: 'Search the semantic knowledge base for relevant documents and information.',
      schema: z.object({
        query: z.string().describe('The search query to find relevant information.')
      })
    }
  );
};
