import { GoogleGenAI } from "@google/genai";
import { AIResponseBlock, CSVData, ExecutionPlan } from '../types';
import { executePlan } from './planExecutor';

// This `declare` block informs TypeScript that the `process` object is globally available.
// Vite's `define` configuration will replace these variables with their actual values
// at build time, preventing runtime errors.
declare var process: {
  env: {
    // This variable is provided by the execution environment, not Vite's define config.
    API_KEY: string;
    // These variables are injected by Vite's define config.
    VITE_AI_PROVIDER: string;
    VITE_AI_GATEWAY_URL: string;
    VITE_AI_GATEWAY_API_KEY: string;
    VITE_AI_GATEWAY_MODEL: string;
  }
};

// --- AI Provider Configuration ---
const model = 'gemini-2.5-pro';

// Read configuration from the process.env object. Vite's `define` config replaces these
// variable names with their literal string values during the build.
const aiProvider = process.env.VITE_AI_PROVIDER || 'GEMINI';
const gatewayUrl = process.env.VITE_AI_GATEWAY_URL;
const gatewayApiKey = process.env.VITE_AI_GATEWAY_API_KEY;
const gatewayModel = process.env.VITE_AI_GATEWAY_MODEL;

// Per project guidelines, the Gemini API key MUST come exclusively from the execution
// environment's `process.env.API_KEY`.
const geminiApiKey = process.env.API_KEY;

// --- Startup Logging: Log the configuration as soon as the module is loaded ---
console.groupCollapsed('[AI Service] Configuration Loaded');
console.info(`AI Provider: %c${aiProvider}`, 'font-weight: bold;');
if (aiProvider === 'GATEWAY') {
    console.log(`Gateway Base URL: ${gatewayUrl || 'Not Set'}`);
    console.log(`Gateway Model: ${gatewayModel || `(default: ${model})`}`);
    console.log(`Gateway API Key Set: %c${!!gatewayApiKey}`, `font-weight: bold; color: ${!!gatewayApiKey ? 'green' : 'red'};`);
} else {
     console.log(`Gemini API Key Set: %c${!!geminiApiKey}`, `font-weight: bold; color: ${!!geminiApiKey ? 'green' : 'red'};`);
}
console.groupEnd();

if (aiProvider === 'GATEWAY' && (!gatewayUrl || !gatewayApiKey)) {
    console.error('[AI Service] CRITICAL: AI Gateway is the configured provider, but VITE_AI_GATEWAY_URL or VITE_AI_GATEWAY_API_KEY is missing in your .env file.');
} else if (aiProvider === 'GEMINI' && !geminiApiKey) {
    console.error('[AI Service] CRITICAL: Gemini is the configured provider, but the API_KEY was not found in the environment. This must be configured in the execution environment where the app is hosted.');
}
// --- End of Startup Logging ---

// System instruction for the "Analyst" model
const analysisSystemInstruction = `
You are an expert supply chain data analyst. Your task is to analyze the provided data from a spreadsheet which contains Advanced Shipment Notice (ASN) and warehouse receiving information. The user's prompt may include pre-calculated metrics and a focused subset of the data. If metrics are provided, you MUST use them in your analysis and explanation. Your goal is to provide root cause analysis, identify risks, and explain the "why" behind the numbers.

Here is the definition of the columns in the data:
- loc_no: The warehouse number (numeric).
- carrier: The shipping carrier (e.g., UPS, FEDEX).
- rec_date: The date the shipment was received at the warehouse.
- tracking_no: The tracking number scanned from the package at the warehouse.
- vend_track_no: The tracking number provided by the vendor in the shipment notice. A key analysis is to compare this with 'tracking_no' for mismatches.
- api_source: The channel through which the shipment notice was received.
- return_po: The Purchase Order number matched to the tracking number. Missing values here can indicate a potential problem.
- run_date: The date this report was generated.
- week_period / week_begin: The weekly period the data belongs to.

You have also been provided with a knowledge base containing rules, data structure explanations, or other context. You MUST use this information to inform your analysis.

You MUST respond with a JSON array of "blocks". Each block represents a piece of content to be displayed.
The response must be a valid JSON array conforming to the following TypeScript interfaces:

// A single block of content in an AI response
export interface AIResponseBlock {
  type: 'card' | 'table' | 'chart' | 'markdown';
  data: CardData | TableData | ChartData | string; // For markdown, data is a string. For others, it's an object.
}

// Data for a 'card' block
export interface CardData {
  title: string;
  value: string;
  description?: string;
}

// Data for a 'table' block
export interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

// Data for a 'chart' block
export interface ChartData {
  type: 'bar' | 'pie' | 'line' | 'doughnut';
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string[]; // Recommended for pie/doughnut/bar charts
  }[];
}

// Your response should be a JSON array of AIResponseBlock objects.
// Example: 
// [ 
//   { "type": "markdown", "data": "Here is a summary of the data." }, 
//   { "type": "card", "data": { "title": "Total Mismatches", "value": "12", "description": "12% of total shipments." } },
//   { "type": "chart", "data": { "type": "pie", "labels": ["Matched", "Mismatched"], "datasets": [{ "label": "Tracking Numbers", "data": [88, 12] }] } }
// ]

- When creating charts, select appropriate colors. For single-dataset bar/line charts, a single color is fine. For pie/doughnut charts, provide a list of colors for 'backgroundColor'.
- When the user asks for a summary or general analysis, provide a mix of markdown, cards, and charts focusing on key supply chain metrics like match rates.
- Keep your analysis concise and directly related to the user's query.
- The entire response must be a single JSON string, which is an array of these block objects. Do not add any text before or after the JSON array.
`;

// System instruction for the "Pre-Analyzer" model, which creates an execution plan.
const preAnalysisSystemInstruction = `You are a data analysis planner. Your job is to take a user's question and create a structured JSON plan for a program to execute. The program will first perform calculations and filtering, and then pass the results to another AI for reasoning.

Based on the user's question, available columns, and knowledge base, create a JSON object representing the plan.

The plan can have one of two actions:
1. 'direct_analysis': Use this for broad, general questions that don't require pre-calculation (e.g., "Summarize the data", "What is in this file?").
2. 'filter_and_analyze': Use this for specific questions about a subset of data (e.g., "Why is VEND-A's mismatch rate high?", "Find issues with FEDEX shipments").

The JSON object must follow this interface:
interface ExecutionPlan {
  action: 'direct_analysis' | 'filter_and_analyze';
  filters?: {
    column: string; // Must be one of the available columns
    operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty';
    value?: string | number; // Not needed for is_empty/is_not_empty
  }[];
  calculations?: ('mismatch_rate' | 'missing_po_rate' | 'count')[];
  data_subset_columns?: string[];
}

Example 1:
User Question: "Give me a summary of the data."
Your Response:
{ "action": "direct_analysis" }

Example 2:
User Question: "Why are there so many mismatches for UPS?"
Available Columns: ["loc_no", "carrier", "tracking_no", "vend_track_no", "api_source"]
Your Response:
{
  "action": "filter_and_analyze",
  "filters": [
    { "column": "carrier", "operator": "equals", "value": "UPS" }
  ],
  "calculations": ["mismatch_rate", "count"],
  "data_subset_columns": ["*"]
}

Example 3:
User Question: "Find shipments from vend_code VEND-B that are missing a return_po."
Your Response:
{
  "action": "filter_and_analyze",
  "filters": [
    { "column": "vend_code", "operator": "equals", "value": "VEND-B" },
    { "column": "return_po", "operator": "is_empty" }
  ],
  "calculations": ["count"],
  "data_subset_columns": ["*"]
}

Respond ONLY with the JSON plan object.`;


// Helper to convert CSV data to a markdown-like string for the prompt
const csvToText = (csvData: CSVData): string => {
    if (!csvData || csvData.rows.length === 0) {
        return "No data to display.";
    }
    const header = csvData.headers.join(',');
    const rows = csvData.rows.map(row => csvData.headers.map(h => row[h]).join(','));
    return [header, ...rows].join('\n');
}

/**
 * Internal helper to make a POST request to the AI Gateway, following an OpenAI-compatible structure.
 */
const callAiGateway = async (systemPrompt: string, userPrompt: string): Promise<any> => {
    if (!gatewayUrl || !gatewayApiKey) {
        throw new Error('AI Gateway is configured, but URL or API Key is missing.');
    }
    
    const modelToUse = gatewayModel || model;
    
    const fullGatewayUrl = `${gatewayUrl}/${modelToUse}/v1/chat/completions`;

    console.log(`[AI Service] Sending request to Gateway URL: %c${fullGatewayUrl}`, 'font-weight: bold;');

    const requestBody = {
        model: modelToUse,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        stream: false,
    };
    
    const response = await fetch(fullGatewayUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gatewayApiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI Gateway request failed with status ${response.status}: ${errorText}`);
    }

    const responseJson = await response.json();
    if (responseJson.choices && responseJson.choices[0] && responseJson.choices[0].message && responseJson.choices[0].message.content) {
        const content = responseJson.choices[0].message.content;
        return content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else {
        throw new Error('Invalid response structure from AI Gateway.');
    }
};

/**
 * Step 1: The "Pre-Analyzer" - creates an execution plan.
 */
const getExecutionPlan = async (headers: string[], prompt: string, knowledgeContent: string): Promise<ExecutionPlan> => {
    const preAnalysisUserPrompt = `
    ${knowledgeContent ? `--- KNOWLEDGE BASE ---\n${knowledgeContent}\n--- END KNOWLEDGE BASE ---\n\n` : ''}
    User Question: "${prompt}"
    Available Columns: ${JSON.stringify(headers)}
    `;

    let jsonText: string;

    if (aiProvider === 'GATEWAY') {
        jsonText = await callAiGateway(preAnalysisSystemInstruction, preAnalysisUserPrompt);
    } else {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const response = await ai.models.generateContent({
            model: model,
            contents: preAnalysisUserPrompt,
            config: {
                systemInstruction: preAnalysisSystemInstruction,
                responseMimeType: "application/json",
            }
        });
        jsonText = response.text;
    }
    
    const result = JSON.parse(jsonText);
    return result as ExecutionPlan;
};

/**
 * Main function to generate insights, orchestrating the pre-analysis, local execution, and final analysis steps.
 */
export const generateInsights = async (fullCsvData: CSVData, prompt: string, knowledgeContent: string): Promise<AIResponseBlock[]> => {
    try {
        // --- PRE-ANALYSIS STEP ---
        console.log('[AI Service] Step 1: Pre-analysis - creating execution plan...');
        const plan = await getExecutionPlan(fullCsvData.headers, prompt, knowledgeContent);
        console.log('[AI Service] Execution plan received:', plan);
        
        let contextualPrompt = prompt;
        let dataForAnalyst = fullCsvData;

        if (plan.action === 'filter_and_analyze') {
            // --- LOCAL EXECUTION STEP ---
            console.log('[AI Service] Step 2: Executing plan locally...');
            const { metrics, subset } = executePlan(plan, fullCsvData);
            dataForAnalyst = subset;
            
            let metricsSummary = "Here are some pre-calculated metrics for context:\n";
            if (metrics.count !== undefined) metricsSummary += `- Total matching records: ${metrics.count}\n`;
            if (metrics.mismatch_rate !== undefined) metricsSummary += `- Tracking Mismatch Rate: ${metrics.mismatch_rate.toFixed(2)}%\n`;
            if (metrics.missing_po_rate !== undefined) metricsSummary += `- Missing PO Rate: ${metrics.missing_po_rate.toFixed(2)}%\n`;

            console.log('[AI Service] Pre-calculated metrics:', metricsSummary);

            contextualPrompt = `
${metricsSummary}
Based on the metrics above and the provided data subset (which might be empty), please answer my original question: "${prompt}"
Focus on root cause analysis, risks, or discrepancies. If the data subset is empty, please state that no records matched the criteria.
`;
        } else {
             console.log('[AI Service] Plan is direct_analysis, proceeding with full dataset.');
        }


        // --- ANALYST STEP ---
        console.log('[AI Service] Step 3: Analyzing - generating insights with contextual data...');
        const dataAsText = csvToText(dataForAnalyst);
        const fullPrompt = `
${knowledgeContent ? `--- KNOWLEDGE BASE ---\n${knowledgeContent}\n--- END KNOWLEDGE BASE ---\n\n` : ''}
Here is the data I'm working with (it may have been pre-filtered based on my query):
---
${dataAsText}
---

My request is:
${contextualPrompt}

Please provide the analysis based on my request and the knowledge base provided.
`;
        
        let jsonText: string;

        if (aiProvider === 'GATEWAY') {
            console.log('[AI Service] Using AI Gateway provider for analysis.');
            jsonText = await callAiGateway(analysisSystemInstruction, fullPrompt);
        } else {
            console.log('[AI Service] Using Gemini provider for analysis.');
            if (!geminiApiKey) {
                throw new Error('Gemini is the configured provider, but the API_KEY is missing.');
            }
            const ai = new GoogleGenAI({ apiKey: geminiApiKey });
            const response = await ai.models.generateContent({
                model: model,
                contents: fullPrompt,
                config: {
                    systemInstruction: analysisSystemInstruction,
                    responseMimeType: "application/json",
                }
            });
            jsonText = response.text;
        }
        
        const cleanedJsonText = jsonText.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const result: AIResponseBlock[] = JSON.parse(cleanedJsonText);
        return result;

    } catch (error)
    {
        console.error("Error generating insights:", error);
        let errorMessage = `**Error:** I encountered a problem while generating the analysis. This could be due to a malformed response from the AI, a network issue, or a configuration problem. Please check the console for more details or try rephrasing your question.`;
        if(error instanceof Error){
          if(error.message.includes("JSON")){
            errorMessage += "\n\n*Developer Note: The AI returned a response that was not valid JSON. This can happen with complex queries. Check the `Network` tab or console logs to see the raw response.*";
          }
        }
        
        const errorResponse: AIResponseBlock[] = [
            {
                type: 'markdown',
                data: errorMessage
            }
        ];
        return errorResponse;
    }
}
