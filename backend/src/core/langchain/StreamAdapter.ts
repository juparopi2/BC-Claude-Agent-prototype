import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { AgentEvent, UsageEvent } from '../../types'; 
import { v4 as uuidv4 } from 'uuid'; 

/**
 * Adapter to convert LangChain stream events to our legacy AgentEvent format.
 * This ensures the frontend doesn't need to change immediately.
 */
export class StreamAdapter {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  processChunk(event: StreamEvent): AgentEvent | UsageEvent | null {
    const eventType = event.event;

    // 1. Text Generation (Tokens)
    if (eventType === 'on_chat_model_stream') {
        const chunk = event.data.chunk;
        // Check for content (standard text)
        if (chunk.content) {
            return {
                type: 'message_chunk',
                content: chunk.content.toString(),
                timestamp: new Date(),
                eventId: uuidv4(),
                persistenceState: 'transient'
            };
        }
    }

    // 2. Tool Start
    if (eventType === 'on_tool_start') {
        return {
            type: 'tool_use',
            toolName: event.name,
            args: event.data.input,
            toolUseId: event.run_id,
            timestamp: new Date(),
            eventId: uuidv4(),
            persistenceState: 'pending'
        };
    }

    // 3. Tool End
    if (eventType === 'on_tool_end') {
         // Output can be a string or object. legacy expects string usually.
         const output = typeof event.data.output === 'string' 
            ? event.data.output 
            : JSON.stringify(event.data.output);

        return {
            type: 'tool_result',
            toolName: event.name,
            result: output,
            success: true, // Assuming success if we reached here
            toolUseId: event.run_id,
            timestamp: new Date(),
            eventId: uuidv4(),
            persistenceState: 'pending'
        };
    }

    // 4. Chain End (Final Answer or Model End)
    if (eventType === 'on_chat_model_end') {
        const output = event.data.output;
        if (output && output.llmOutput && output.llmOutput.usage) {
            return {
                type: 'usage', // Custom internal type, cast to any in service if needed or handle explicitly
                usage: output.llmOutput.usage,
                timestamp: new Date(),
                eventId: uuidv4(),
                persistenceState: 'transient'
            } as UsageEvent;
        }
    }
    
    return null;
  }
}
