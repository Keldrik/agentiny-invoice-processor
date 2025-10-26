import { Agent } from '@agentiny/core';
import { createAnthropicAction } from '@agentiny/anthropic';

const KEY = process.env.DEV_ANTHROPIC_API_KEY;
if (!KEY) {
  throw new Error('Please set your DEV_ANTHROPIC_API_KEY in the environment variables.');
}
const MODEL = 'claude-haiku-4-5';

// State interface for the invoice processing pipeline
interface InvoiceState {
  // Input
  documentPath?: string;
  documentContent?: string;
  
  // Extraction stage
  extractedData?: {
    vendor: string;
    date: string;
    invoiceNumber: string;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;
    subtotal: number;
    tax: number;
    total: number;
  };
  
  // Validation stage
  validationResults?: {
    mathCorrect: boolean;
    hasAllFields: boolean;
    issues: string[];
  };
  
  // Categorization stage
  category?: string;
  confidence?: number;
  
  // Anomaly detection
  anomalies?: string[];
  
  // Final output
  status?: 'pending' | 'processing' | 'validated' | 'flagged' | 'completed';
  report?: string;
}

// Create the invoice processing agent
const invoiceAgent = new Agent<InvoiceState>({
  initialState: {
    status: 'pending',
  },
  onError: (error) => {
    console.error('❌ Agent error:', error.message);
  },
});

// STAGE 1: Extract structured data from document
const extractDataAction = createAnthropicAction<InvoiceState>(
  {
    apiKey: KEY,
    model: MODEL,
  },
  {
    prompt: (state) => `
You are analyzing an invoice/receipt. Extract the following information in JSON format:

Document content:
${state.documentContent}

Extract and return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "vendor": "company name",
  "date": "YYYY-MM-DD",
  "invoiceNumber": "invoice number",
  "items": [
    {
      "description": "item description",
      "quantity": 1,
      "unitPrice": 10.00,
      "total": 10.00
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00
}

Be precise with numbers. Ensure all totals are calculated correctly.
`,
    onResponse: (response, state) => {
      try {
        // Parse the JSON response
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        state.extractedData = JSON.parse(cleaned);
        state.status = 'processing';
        console.log('✓ Data extracted successfully');
      } catch (error) {
        console.error('Failed to parse extraction:', error);
        state.status = 'flagged';
      }
    },
    maxTokens: 2000,
    temperature: 0.1,
  }
);

// STAGE 2: Validate the extracted data
const validateDataAction = createAnthropicAction<InvoiceState>(
  {
    apiKey: KEY,
    model: MODEL,
  },
  {
    prompt: (state) => `
Validate this extracted invoice data for accuracy and completeness:

${JSON.stringify(state.extractedData, null, 2)}

Check:
1. Do item totals = quantity × unitPrice?
2. Does subtotal = sum of item totals?
3. Does total = subtotal + tax?
4. Are all required fields present (vendor, date, invoiceNumber)?
5. Are there any suspicious values (negative amounts, unrealistic prices)?

Return ONLY valid JSON (no markdown) with this structure:
{
  "mathCorrect": true/false,
  "hasAllFields": true/false,
  "issues": ["list of any problems found"]
}
`,
    onResponse: (response, state) => {
      try {
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        state.validationResults = JSON.parse(cleaned);
        console.log('✓ Validation completed');
      } catch (error) {
        console.error('Failed to parse validation:', error);
      }
    },
    maxTokens: 1000,
    temperature: 0.1,
  }
);

// STAGE 3: Categorize the expense
const categorizeAction = createAnthropicAction<InvoiceState>(
  {
    apiKey: KEY,
    model: MODEL,
  },
  {
    prompt: (state) => `
Categorize this business expense based on the vendor and items:

Vendor: ${state.extractedData?.vendor}
Items: ${state.extractedData?.items.map(i => i.description).join(', ')}

Choose ONE category from: Office Supplies, Travel, Meals & Entertainment, Software, Equipment, Marketing, Utilities, Other

Return ONLY valid JSON (no markdown):
{
  "category": "category name",
  "confidence": 0.95
}
`,
    onResponse: (response, state) => {
      try {
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(cleaned);
        state.category = result.category;
        state.confidence = result.confidence;
        console.log(`✓ Categorized as: ${state.category} (${(result.confidence * 100).toFixed(0)}% confidence)`);
      } catch (error) {
        console.error('Failed to parse categorization:', error);
      }
    },
    maxTokens: 500,
    temperature: 0.2,
  }
);

// STAGE 4: Detect anomalies
const detectAnomaliesAction = createAnthropicAction<InvoiceState>(
  {
    apiKey: KEY,
    model: MODEL,
  },
  {
    prompt: (state) => `
Analyze this invoice for potential anomalies or red flags:

${JSON.stringify(state.extractedData, null, 2)}

Validation: ${JSON.stringify(state.validationResults, null, 2)}

Check for:
- Unusually high amounts for the category
- Round numbers that seem suspicious
- Missing documentation
- Duplicate charges
- Weekend/holiday charges
- Validation errors

Return ONLY valid JSON (no markdown):
{
  "anomalies": ["list of concerns, or empty array if none"]
}
`,
    onResponse: (response, state) => {
      try {
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(cleaned);
        state.anomalies = result.anomalies;
        
        if (state.anomalies && state.anomalies.length > 0) {
          state.status = 'flagged';
          console.log('⚠ Anomalies detected:', state.anomalies.length);
        } else {
          state.status = 'validated';
          console.log('✓ No anomalies detected');
        }
      } catch (error) {
        console.error('Failed to parse anomaly detection:', error);
      }
    },
    maxTokens: 1000,
    temperature: 0.2,
  }
);

// STAGE 5: Generate final report
const generateReportAction = createAnthropicAction<InvoiceState>(
  {
    apiKey: KEY,
    model: MODEL,
  },
  {
    prompt: (state) => `
Generate a concise executive summary for this processed invoice:

Data: ${JSON.stringify(state.extractedData, null, 2)}
Category: ${state.category}
Validation: ${JSON.stringify(state.validationResults, null, 2)}
Anomalies: ${JSON.stringify(state.anomalies, null, 2)}

Create a brief, professional summary (3-4 sentences) covering:
- What was purchased and from whom
- Total amount and category
- Validation status
- Any concerns

Keep it concise and actionable.
`,
    onResponse: (response, state) => {
      state.report = response.trim();
      state.status = 'completed';
      console.log('✓ Report generated');
    },
    maxTokens: 500,
    temperature: 0.3,
  }
);

// TRIGGER CONFIGURATION: Define the reactive pipeline

// Trigger 1: Start extraction when document is loaded
invoiceAgent.once(
  (state) => !!state.documentContent && !state.extractedData,
  [extractDataAction]
);

// Trigger 2: Validate after extraction
invoiceAgent.once(
  (state) => !!state.extractedData && !state.validationResults,
  [validateDataAction]
);

// Trigger 3: Categorize after validation
invoiceAgent.once(
  (state) => !!state.validationResults && !state.category,
  [categorizeAction]
);

// Trigger 4: Detect anomalies after categorization
invoiceAgent.once(
  (state) => !!state.category && state.anomalies === undefined,
  [detectAnomaliesAction]
);

// Trigger 5: Generate report after anomaly detection
invoiceAgent.once(
  (state) => state.anomalies !== undefined && !state.report,
  [generateReportAction]
);

// DEMO: Process a sample invoice
async function processInvoice() {
  console.log('🚀 Starting Invoice Processing Agent\n');
  
  // Start the agent
  await invoiceAgent.start();
  
  // Simulate loading a document (in real app, this would be OCR'd PDF/image)
  const sampleInvoice = `
ACME Office Supplies Inc.
Invoice #INV-2024-001234
Date: 2024-10-15

Bill To: Your Company Inc.

Items:
1. HP Printer Ink Cartridges (Black) - Qty: 3 - $29.99 each - $89.97
2. Copy Paper (Reams) - Qty: 10 - $6.50 each - $65.00
3. Stapler Heavy Duty - Qty: 2 - $15.25 each - $30.50
4. Sticky Notes Variety Pack - Qty: 5 - $3.99 each - $19.95

Subtotal: $205.42
Tax (8.5%): $17.46
Total: $222.88

Payment Due: Net 30
  `.trim();
  
  console.log('📄 Document loaded\n');
  
  // Set the document content - this triggers the entire pipeline
  invoiceAgent.setState({
    documentPath: 'sample-invoice.txt',
    documentContent: sampleInvoice,
    status: 'processing',
  });
  
  // Wait for processing to complete
  await invoiceAgent.settle(); // Wait until all actions are processed
  
  // Display results
  const finalState = invoiceAgent.getState();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 INVOICE PROCESSING RESULTS');
  console.log('='.repeat(60) + '\n');
  
  console.log('📋 Extracted Data:');
  console.log(JSON.stringify(finalState.extractedData, null, 2));
  console.log('\n' + '-'.repeat(60) + '\n');
  
  console.log('✅ Validation:');
  console.log(`Math Correct: ${finalState.validationResults?.mathCorrect ? '✓' : '✗'}`);
  console.log(`All Fields Present: ${finalState.validationResults?.hasAllFields ? '✓' : '✗'}`);
  if (finalState.validationResults?.issues.length) {
    console.log(`Issues: ${finalState.validationResults.issues.join(', ')}`);
  }
  console.log('\n' + '-'.repeat(60) + '\n');
  
  console.log('🏷️  Category:', finalState.category);
  console.log('📈 Confidence:', `${(finalState.confidence! * 100).toFixed(0)}%`);
  console.log('\n' + '-'.repeat(60) + '\n');
  
  console.log('⚠️  Anomalies:');
  if (finalState.anomalies?.length) {
    finalState.anomalies.forEach((a, i) => console.log(`   ${i + 1}. ${a}`));
  } else {
    console.log('   None detected');
  }
  console.log('\n' + '-'.repeat(60) + '\n');
  
  console.log('📝 Executive Summary:');
  console.log(finalState.report);
  console.log('\n' + '='.repeat(60) + '\n');
  
  console.log(`Status: ${finalState.status}`);
  
  // Stop the agent
  await invoiceAgent.stop();
  console.log('\n✓ Agent stopped');
}

// Run the demo
processInvoice().catch(console.error);
