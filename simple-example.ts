import { Agent } from '@agentiny/core';
import { createAnthropicAction } from '@agentiny/anthropic';

/**
 * SIMPLE INVOICE PROCESSOR
 * 
 * A minimal example showing how to build a reactive document processing pipeline.
 * Perfect for understanding the basics before diving into the full example.
 */

interface SimpleInvoiceState {
  documentText?: string;
  extractedAmount?: number;
  category?: string;
  summary?: string;
}

// Create agent
const agent = new Agent<SimpleInvoiceState>({
  initialState: {},
});

// Step 1: Extract the total amount
const extractAmount = createAnthropicAction<SimpleInvoiceState>(
  { apiKey: process.env.DEV_ANTHROPIC_API_KEY! },
  {
    prompt: (state) => 
      `Extract only the total amount from this invoice. Return just the number: ${state.documentText}`,
    onResponse: (response, state) => {
      state.extractedAmount = parseFloat(response.replace(/[^0-9.]/g, ''));
      console.log(`✓ Extracted amount: $${state.extractedAmount}`);
    },
  }
);

// Step 2: Categorize the expense
const categorize = createAnthropicAction<SimpleInvoiceState>(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => 
      `What expense category is this? Choose one: Office, Travel, or Food. Document: ${state.documentText}`,
    onResponse: (response, state) => {
      state.category = response.trim();
      console.log(`✓ Categorized as: ${state.category}`);
    },
  }
);

// Step 3: Generate summary
const summarize = createAnthropicAction<SimpleInvoiceState>(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => 
      `Write a one-sentence summary of this $${state.extractedAmount} ${state.category} expense.`,
    onResponse: (response, state) => {
      state.summary = response.trim();
      console.log(`✓ Summary: ${state.summary}`);
    },
  }
);

// Define the reactive pipeline
agent.once(
  (state) => !!state.documentText && !state.extractedAmount,
  [extractAmount]
);

agent.once(
  (state) => !!state.extractedAmount && !state.category,
  [categorize]
);

agent.once(
  (state) => !!state.category && !state.summary,
  [summarize]
);

// Run it
async function run() {
  await agent.start();
  
  // Just set the document - the pipeline handles the rest!
  agent.setState({
    documentText: 'ACME Corp - Office Supplies - Total: $127.50'
  });
  
  // Wait for completion
  await new Promise(r => setTimeout(r, 8000));
  
  const final = agent.getState();
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(final, null, 2));
  
  await agent.stop();
}

run();
