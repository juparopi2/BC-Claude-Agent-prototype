import { AgentState } from './state';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
import { SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

const RouterOutputSchema = z.object({
  target_agent: z.enum(['business-central', 'rag-knowledge', 'orchestrator']),
  reasoning: z.string().describe("Why this agent was selected"),
});

const ROUTER_SYSTEM_PROMPT = `You are the Main Orchestrator for the Direct Agent system.
Your job is to route the user's request to the specialized agent best suited to handle it.

AVAILABLE AGENTS:
1. 'business-central' (BC Agent):
   - Use for: Microsoft Business Central operations, ERP data, finance, consumers, vendors, transactions.
   - Triggers: "Find customer X", "Create invoice", "Check inventory", "BC status".

2. 'rag-knowledge' (Knowledge Agent):
   - Use for: Semantic search, document analysis, "finding information in files", analyzing PDFs/Images.
   - Triggers: "Search for contracts", "Summarize this PDF", "Find images of...", "What does the policy say?".

3. 'orchestrator' (Self):
   - Use for: General chit-chat, clarifications, or when the request is unclear and needs more info.
   - Triggers: "Hello", "Refine my request", "Who are you?".

RULES:
- If we are ALREADY in a specific agent's context (e.g. user previously asked for BC), try to stick to it unless intent clearly changes.
- Look for explicit 'Slash Commands' like '/bc' or '/search' in the input text to force routing.
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

  // 1. Check for Slash Commands (Hard Override)
  if (input.startsWith('/bc')) {
    return { activeAgent: 'business-central' };
  }
  if (input.startsWith('/search') || input.startsWith('/rag')) {
    return { activeAgent: 'rag-knowledge' };
  }

  // 2. Use LLM for Soft Routing
  const model = ModelFactory.create({
    provider: 'anthropic', // Use fast model for routing
    modelName: 'claude-3-5-haiku-20241022', 
    temperature: 0,
  }).withStructuredOutput(RouterOutputSchema);

  try {
    const result = await model.invoke([
      new SystemMessage(ROUTER_SYSTEM_PROMPT),
      lastMessage
    ]);

    return { activeAgent: result.target_agent };
  } catch (error) {
    console.error("Router LLM failed, defaulting to orchestrator", error);
    return { activeAgent: 'orchestrator' };
  }
}
