
import { GoogleGenAI, Type, Content } from "@google/genai";
import type { ChatMessage, AIResponseBlock } from '../types';

// This declare block informs TypeScript that the process object is globally available.
// Vite's define configuration will replace these variables with their actual values
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

// --- Configuration Loading ---
const aiProvider = process.env.VITE_AI_PROVIDER || 'GEMINI';
const gatewayUrl = process.env.VITE_AI_GATEWAY_URL;
const gatewayApiKey = process.env.VITE_AI_GATEWAY_API_KEY;
const gatewayModel = process.env.VITE_AI_GATEWAY_MODEL;
const geminiApiKey = process.env.API_KEY;
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

// --- Startup Logging: Log the configuration as soon as the module is loaded ---
console.groupCollapsed('[AI Service] Configuration Loaded');
console.info(`AI Provider: %c${aiProvider}`, 'font-weight: bold;');
if (aiProvider === 'GATEWAY') {
    console.log(`Gateway Base URL: ${gatewayUrl || 'Not Set'}`);
    console.info(`(Note: The final URL will be constructed as \`{Base URL}/{Model}/v1/chat/completions\`)`);
    console.log(`Gateway Model: ${gatewayModel || `(default: ${GEMINI_DEFAULT_MODEL})`}`);
    console.log(`Gateway API Key Set: %c${!!gatewayApiKey}`, `font-weight: bold; color: ${!!gatewayApiKey ? 'green' : 'red'};`);
} else {
     console.log(`Gemini API Key Set: %c${!!geminiApiKey}`, `font-weight: bold; color: ${!!geminiApiKey ? 'green' : 'red'};`);
}
console.groupEnd();

if (aiProvider === 'GATEWAY' && (!gatewayUrl || !gatewayApiKey)) {
    console.error('[AI Service] CRITICAL: AI Gateway is the configured provider, but VITE_AI_GATEWAY_URL or VITE_AI_GATEWAY_API_KEY is missing in your .env file.');
} else if (aiProvider === 'GEMINI' && !geminiApiKey) {
    console.error('[AI Service] CRITICAL: Gemini is the configured provider, but the API_KEY was not found in the environment.');
}
// --- End of Startup Logging ---

let aiInstance: GoogleGenAI | null = null;
const getAiInstance = () => {
    if (!aiInstance) {
        if (!geminiApiKey) {
            throw new Error("Gemini API Key is not configured in the execution environment.");
        }
        aiInstance = new GoogleGenAI({ apiKey: geminiApiKey });
    }
    return aiInstance;
};

// --- System Instructions & Schemas ---

const analysisSystemInstruction = (contextualData: string) => `You are a world-class AI data analyst... (instructions as before)`;
const responseSchema = { /* ... schema as before ... */ };
const plannerSystemInstruction = `You are an intelligent data analysis planner... (instructions as before)`;
const plannerSchema = { /* ... schema as before ... */ };
// FIX: `analysisSystemInstruction` is a function, so `analysisSystemInstructionForGateway`
// must also be a function to properly handle the `contextualData` parameter.
const analysisSystemInstructionForGateway = (contextualData: string) => analysisSystemInstruction(contextualData) + '\n\nYour response MUST be a valid JSON object.';
const plannerSystemInstructionForGateway = plannerSystemInstruction + `\n\nYour response MUST be a valid JSON object matching this schema: { "columns": ["column_name_1", "column_name_2"] }`;

// --- API Call Functions ---

export const getRequiredColumnsForQuery = async (query: string, headers: string[]): Promise<string[]> => {
    const prompt = `User Query: "${query}"\nAvailable Columns: [${headers.join(', ')}]`;
    try {
        let jsonText: string;

        if (aiProvider === 'GATEWAY') {
            const modelToUse = gatewayModel || GEMINI_DEFAULT_MODEL;
            const fullGatewayUrl = `${gatewayUrl}/${modelToUse}/v1/chat/completions`;
            const requestBody = {
                model: modelToUse,
                messages: [
                    { role: 'system', content: plannerSystemInstructionForGateway },
                    { role: 'user', content: prompt }
                ],
                stream: false,
            };
            const response = await fetch(fullGatewayUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gatewayApiKey}` },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) throw new Error(`Gateway request failed with status ${response.status}: ${await response.text()}`);
            const data = await response.json();
            jsonText = data.choices[0]?.message?.content;
            if (!jsonText) throw new Error('Gateway response did not contain expected content.');
        } else {
            const ai = getAiInstance();
            const response = await ai.models.generateContent({
                model: GEMINI_DEFAULT_MODEL,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    systemInstruction: plannerSystemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: plannerSchema,
                }
            });
            jsonText = response.text;
        }

        const parsedResponse = JSON.parse(jsonText.trim());
        return parsedResponse.columns && Array.isArray(parsedResponse.columns) ? parsedResponse.columns : ['*'];
    } catch (error) {
        console.error(`Error in planner AI call (Provider: ${aiProvider}):`, error);
        return ['*'];
    }
};

export const getAIResponse = async (history: ChatMessage[], contextualData: string): Promise<AIResponseBlock[]> => {
    try {
        let jsonText: string;

        if (aiProvider === 'GATEWAY') {
            const modelToUse = gatewayModel || GEMINI_DEFAULT_MODEL;
            const fullGatewayUrl = `${gatewayUrl}/${modelToUse}/v1/chat/completions`;
            const messages = history.map(msg => ({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify({ blocks: msg.content })
            }));

            const requestBody = {
                model: modelToUse,
                messages: [
                    { role: 'system', content: analysisSystemInstructionForGateway(contextualData) },
                    ...messages
                ],
                stream: false
            };
            const response = await fetch(fullGatewayUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gatewayApiKey}` },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) throw new Error(`Gateway request failed with status ${response.status}: ${await response.text()}`);
            const data = await response.json();
            jsonText = data.choices[0]?.message?.content;
            if (!jsonText) throw new Error('Gateway response did not contain expected content.');
        } else {
            const ai = getAiInstance();
            const contents: Content[] = history.map(msg => ({
                role: msg.role,
                parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify({ blocks: msg.content }) }]
            }));
            const response = await ai.models.generateContent({
                model: GEMINI_DEFAULT_MODEL,
                contents: contents,
                config: {
                    systemInstruction: analysisSystemInstruction(contextualData),
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                }
            });
            jsonText = response.text;
        }
        
        const parsedResponse = JSON.parse(jsonText.trim());
        if (!parsedResponse.blocks || !Array.isArray(parsedResponse.blocks)) {
            throw new Error("Invalid response format from AI: 'blocks' array not found.");
        }
        return parsedResponse.blocks as AIResponseBlock[];
    } catch (error) {
        console.error(`Error calling AI (Provider: ${aiProvider}):`, error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        return [{
            type: 'markdown',
            data: `**Error:** An error occurred while analyzing the data: ${message}. Please check the console for more details.`
        }];
    }
};