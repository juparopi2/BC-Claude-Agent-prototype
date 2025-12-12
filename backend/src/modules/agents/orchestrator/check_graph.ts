
import { orchestratorGraph } from './graph';
import { HumanMessage } from '@langchain/core/messages';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

async function main() {
  console.log("Starting Graph Verification...");

  const inputs = [
    "Hello, who are you?",
    "/bc status",
    "Find semantic documents about contracts"
  ];

  for (const input of inputs) {
    console.log(`\n\n--- Input: "${input}" ---`);
    const result = await orchestratorGraph.invoke({
        messages: [new HumanMessage(input)]
    });

    console.log("Active Agent:", result.activeAgent);
    if (result.messages && result.messages.length > 0) {
        console.log("Last Message:", result.messages[result.messages.length - 1]!.content);
    } else {
        console.log("No messages returned.");
    }
  }
}

main().catch(console.error);
