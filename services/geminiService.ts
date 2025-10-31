import { GoogleGenAI } from "@google/genai";
import { AIResponseBlock, CSVData } from '../types';

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

// System instruction for the main "Analyst" model
const analysisSystemInstruction = `
You are an expert supply chain data analyst. Your task is to analyze the provided CSV data which contains Advanced Shipment Notice (ASN) and warehouse receiving information.

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

Your primary goal is to identify discrepancies, summarize performance, and answer user questions.

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

// System instruction for the "Planner" model, which selects necessary columns.
const plannerSystemInstruction = `You are an efficient data query planner. Your task is to determine the absolute minimum set of columns required to answer the user's question based on the available CSV columns and any additional knowledge provided.
Respond ONLY with a valid JSON object containing a single key "columns", which is an array of column name strings.
For example: {"columns": ["carrier", "tracking_no"]}.
If the user asks for a general summary, a broad question, or it is otherwise necessary to see all data, respond with {"columns": ["*"]}.`;


// Helper to convert CSV data to a markdown-like string for the prompt
const csvToText = (csvData: CSVData): string => {
    if (!csvData || csvData.rows.length === 0) {
        return "";
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
        // Forcing JSON output is critical for this app's structured responses
    };
    console.log(`[AI Service] Sending  request to Gateway with body:`, JSON.stringify(requestBody, null, 2));
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
        // Gateways sometimes wrap the JSON in markdown, so we clean it.
        return content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else {
        throw new Error('Invalid response structure from AI Gateway.');
    }
};

/**
 * Step 1: The "Planner" - determines which columns are needed for the query.
 */
const getRequiredColumnsForQuery = async (headers: string[], prompt: string, knowledgeContent: string): Promise<string[]> => {
    const plannerUserPrompt = `
    ${knowledgeContent ? `--- KNOWLEDGE BASE ---\n${knowledgeContent}\n--- END KNOWLEDGE BASE ---\n\n` : ''}
    User Question: "${prompt}"
    Available Columns: ${JSON.stringify(headers)}
    `;

    let jsonText: string;

    if (aiProvider === 'GATEWAY') {
        jsonText = await callAiGateway(plannerSystemInstruction, plannerUserPrompt);
    } else {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const response = await ai.models.generateContent({
            model: model,
            contents: plannerUserPrompt,
            config: {
                systemInstruction: plannerSystemInstruction,
                responseMimeType: "application/json",
            }
        });
        jsonText = response.text;
    }
    
    const result = JSON.parse(jsonText);
    return result.columns as string[];
};

/**
 * Main function to generate insights, orchestrating the Planner and Analyst steps.
 */
export const generateInsights = async (fullCsvData: CSVData, prompt: string, knowledgeContent: string): Promise<AIResponseBlock[]> => {
    try {
        // --- PLANNER STEP ---
        console.log('[AI Service] Step 1: Planning - determining required columns...');
        const requiredColumns = await getRequiredColumnsForQuery(fullCsvData.headers, prompt, knowledgeContent);
        console.log('[AI Service] Required columns:', requiredColumns);

        let contextualCsvData = fullCsvData;
        if (requiredColumns.length > 0 && requiredColumns[0] !== '*') {
            contextualCsvData = {
                headers: requiredColumns,
                rows: fullCsvData.rows.map(row => {
                    const newRow: Record<string, string> = {};
                    for (const header of requiredColumns) {
                        newRow[header] = row[header];
                    }
                    return newRow;
                })
            };
        }

        // --- ANALYST STEP ---
        console.log('[AI Service] Step 2: Analyzing - generating insights with contextual data...');
        const dataAsText = csvToText(contextualCsvData);
        const fullPrompt = `
${knowledgeContent ? `--- KNOWLEDGE BASE ---\n${knowledgeContent}\n--- END KNOWLEDGE BASE ---\n\n` : ''}
Here is the CSV data I'm working with (it has been pre-filtered to include only the columns relevant to my query):
---
${dataAsText}
---

My question is: ${prompt}

Please provide the analysis based on my question and the knowledge base provided.
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

    } catch (error) {
        console.error("Error generating insights:", error);
        const errorResponse: AIResponseBlock[] = [
            {
                type: 'markdown',
                data: `**Error:** I encountered a problem while generating the analysis. This could be due to a malformed response from the AI, a network issue, or a configuration problem. Please check the console for more details or try rephrasing your question.`
            }
        ];
        return errorResponse;
    }
}