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
const aiProvider = process.env.VITE_AI_PROVIDER;
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

// System instruction updated with domain-specific knowledge about the supply chain data.
const systemInstruction = `
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

// Helper to convert CSV data to a markdown-like string for the prompt
const csvToText = (csvData: CSVData): string => {
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
    const fullGatewayUrl = `${gatewayUrl}`; // The URL should be the full endpoint URL.

    console.log(`[AI Service] Sending request to Gateway URL: %c${fullGatewayUrl}`, 'font-weight: bold;');

    const requestBody = {
        model: modelToUse,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        stream: false,
        response_format: { "type": "json_object" } // Enforce JSON output
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

    return response.json();
};


export const generateInsights = async (csvData: CSVData, prompt: string): Promise<AIResponseBlock[]> => {
    try {
        const dataAsText = csvToText(csvData);
        const fullPrompt = `
Here is the CSV data I'm working with:
---
${dataAsText}
---

My question is: ${prompt}

Please provide the analysis based on my question.
`;
        
        let jsonText: string;

        if (aiProvider === 'GATEWAY') {
            console.log('[AI Service] Using AI Gateway provider.');
            const gatewayResponse = await callAiGateway(systemInstruction, fullPrompt);
            if (gatewayResponse.choices && gatewayResponse.choices[0] && gatewayResponse.choices[0].message && gatewayResponse.choices[0].message.content) {
                jsonText = gatewayResponse.choices[0].message.content;
            } else {
                throw new Error('Invalid response structure from AI Gateway.');
            }
        } else {
            console.log('[AI Service] Using Gemini provider.');
            if (!geminiApiKey) {
                throw new Error('Gemini is the configured provider, but the API_KEY is missing.');
            }
            const ai = new GoogleGenAI({ apiKey: geminiApiKey });
            const response = await ai.models.generateContent({
                model: model,
                contents: fullPrompt,
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                }
            });
            jsonText = response.text;
        }
        
        // Sometimes the model might wrap the JSON in ```json ... ```
        const cleanedJsonText = jsonText.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');

        const result: AIResponseBlock[] = JSON.parse(cleanedJsonText);
        return result;

    } catch (error) {
        console.error("Error generating insights:", error);
        // Create a user-friendly error response
        const errorResponse: AIResponseBlock[] = [
            {
                type: 'markdown',
                data: `**Error:** I encountered a problem while generating the analysis. This could be due to a malformed response from the AI or a configuration issue. Please check the console for more details or try rephrasing your question.`
            }
        ];
        return errorResponse;
    }
}