import { AgentState } from './state';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
import { getModelConfig } from '../../../config/models';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'RouterNode' });

const RouterOutputSchema = z.object({
  target_agent: z.enum(['business-central', 'rag-knowledge', 'orchestrator']),
  reasoning: z.string().describe("Why this agent was selected"),
});

const ROUTER_SYSTEM_PROMPT = `You are the Main Orchestrator for the Direct Agent system.
Your job is to route the user's request to the specialized agent best suited to handle it.

AVAILABLE AGENTS:
1. 'business-central' (BC Agent):
   - Use for: Microsoft Business Central operations, ERP data, finance, customers, vendors, transactions, invoices.
   - Triggers: "Find customer X", "Create invoice", "Check inventory", "BC status", "Show vendors".
   - DO NOT use for: File analysis, document search, image recognition.

2. 'rag-knowledge' (Knowledge Agent):
   - Use for: Semantic search, document analysis, finding information in user's files, analyzing PDFs/Images.
   - Triggers: "Search for contracts", "Summarize this PDF", "Find images of...", "What does the policy say?", "Look in my files", "Search my documents".
   - REQUIRED when: User has uploaded files or activated "My Files" mode (see CONTEXT below).
   - Capabilities: Vector similarity search, image analysis, PDF text extraction, file content retrieval.

3. 'orchestrator' (Self):
   - Use for: General chit-chat, clarifications, or when the request is ambiguous and needs more context from the user.
   - Triggers: "Hello", "Help me", "What can you do?", "I'm not sure what I need".

ROUTING RULES:
1. If CONTEXT shows FILES_ATTACHED=true, you MUST route to 'rag-knowledge' first.
   - The user explicitly activated file search mode.
   - After RAG processes, other agents (like BC) may be called if needed.
2. If user mentions "files", "documents", "images", "PDFs", or "search my..." → route to 'rag-knowledge'.
3. If user mentions "customer", "invoice", "inventory", "BC", "Business Central" → route to 'business-central'.
4. If the request is unclear, ask for clarification by routing to 'orchestrator'.
5. Slash commands like '/bc' or '/search' override all other routing logic.
`;

export async function routeIntent(state: AgentState): Promise<Partial<AgentState>> {
  const messages = state.messages;
  if (!messages || messages.length === 0) {
    return { activeAgent: 'orchestrator' };
  }
  const lastMessage = messages[messages.length - 1];

  // Safety check for TS
  if (!lastMessage) {
     return { activeAgent: 'orchestrator' };
  }

  const input = lastMessage.content.toString();

  // Detect file context from state
  const hasAttachments = (state.context?.options?.attachments?.length ?? 0) > 0;
  const hasFileContext = !!state.context?.fileContext;
  const filesAreActive = hasAttachments || hasFileContext;
  const fileCount = state.context?.options?.attachments?.length ?? 0;

  logger.debug({
    messageCount: messages.length,
    lastMessagePreview: input.substring(0, 100),
    filesAreActive,
    fileCount,
    hasFileContext
  }, 'Router: Starting intent routing');

  // 1. Check for Slash Commands (Hard Override)
  if (input.startsWith('/bc')) {
    logger.info({ command: 'bc', targetAgent: 'business-central' }, 'Router: Slash command detected');
    return { activeAgent: 'business-central' };
  }
  if (input.startsWith('/search') || input.startsWith('/rag')) {
    logger.info({ command: 'search/rag', targetAgent: 'rag-knowledge' }, 'Router: Slash command detected');
    return { activeAgent: 'rag-knowledge' };
  }

  // 2. Keyword-based routing for Business Central (before LLM to avoid "BC" ambiguity)
  // "BC" can mean "British Columbia" to LLM, so we detect domain-specific patterns
  const lowerInput = input.toLowerCase();
  const bcDomainWords = ['customer', 'customers', 'invoice', 'invoices', 'vendor', 'vendors',
    'inventory', 'sales', 'purchase', 'order', 'orders', 'item', 'items', 'entity', 'entities',
    'ledger', 'account', 'accounts', 'payment', 'payments', 'erp'];

  const hasBcKeyword = lowerInput.includes('business central') ||
    lowerInput.includes('dynamics 365') ||
    lowerInput.includes('dynamics365');

  const hasBcAbbrev = /\bbc\b/.test(lowerInput); // Word boundary to match "bc" but not "abc"
  const hasDomainWord = bcDomainWords.some(word => lowerInput.includes(word));

  if (hasBcKeyword || (hasBcAbbrev && hasDomainWord)) {
    logger.info({
      targetAgent: 'business-central',
      reason: hasBcKeyword ? 'Business Central keyword detected' : 'BC abbreviation with domain context',
      hasBcKeyword,
      hasBcAbbrev,
      hasDomainWord
    }, 'Router: Keyword-based routing to Business Central');
    return { activeAgent: 'business-central' };
  }

  // 3. Hard route to RAG if files are explicitly attached (My Files button)
  // This ensures file context is always used when user activates file mode
  if (filesAreActive) {
    logger.info({
      targetAgent: 'rag-knowledge',
      reason: 'Files attached by user',
      fileCount
    }, 'Router: Auto-routing to RAG due to file context');
    return { activeAgent: 'rag-knowledge' };
  }

  // 4. Use LLM for Soft Routing (using centralized config)
  const routerConfig = getModelConfig('router');
  const model = ModelFactory.create(routerConfig).withStructuredOutput(RouterOutputSchema);

  // Build context-aware system prompt
  const contextSignals = `
CONTEXT (current request):
- FILES_ATTACHED: ${filesAreActive}
- FILE_COUNT: ${fileCount}
`;
  const enhancedSystemPrompt = ROUTER_SYSTEM_PROMPT + contextSignals;

  try {
    logger.debug({ inputPreview: input.substring(0, 100) }, 'Router: Invoking LLM for routing decision');

    const result = await model.invoke([
      new SystemMessage(enhancedSystemPrompt),
      lastMessage
    ]);

    logger.info({
      targetAgent: result.target_agent,
      reasoning: result.reasoning
    }, 'Router: LLM selected agent');

    return { activeAgent: result.target_agent };
  } catch (error) {
    logger.error({
      error: (error as Error).message,
      stack: (error as Error).stack
    }, 'Router: LLM routing failed, defaulting to orchestrator');
    return { activeAgent: 'orchestrator' };
  }
}
