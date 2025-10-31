import { GoogleGenAI, Type } from "@google/genai";
import { AIResponseBlock, CSVData, ChartData, CardData, TableData } from '../types';

// Per guidelines, API key is from process.env.API_KEY and is assumed to be set.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
// fix: Use a model that is suitable for complex text tasks and JSON output.
const model = "gemini-2.5-pro";

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        responses: {
            type: Type.ARRAY,
            description: "A list of response blocks to display to the user.",
            items: {
                type: Type.OBJECT,
                properties: {
                    type: {
                        type: Type.STRING,
                        enum: ['card', 'table', 'chart', 'markdown'],
                        description: "The type of the response block."
                    },
                    data: {
                        type: Type.OBJECT,
                        description: "Data for the block. Structure depends on the block type. For markdown, use the 'markdown' property.",
                        properties: {
                            // CardData
                            title: { type: Type.STRING, description: "Title for the card." },
                            value: { type: Type.STRING, description: "Main value for the card." },
                            description: { type: Type.STRING, description: "Description for the card." },

                            // TableData
                            headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Table headers." },
                            rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } }, description: "Table rows of string values." },

                            // ChartData
                            chartType: { type: Type.STRING, enum: ['bar', 'pie', 'line', 'doughnut'], description: "Type of chart." },
                            labels: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Labels for the chart axes." },
                            datasets: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        label: { type: Type.STRING, description: "Dataset label." },
                                        data: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Numerical data for the dataset." },
                                        backgroundColor: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Background colors for chart elements (e.g. hex codes)." },
                                    },
                                    required: ['label', 'data']
                                },
                                description: "The datasets for the chart."
                            },

                            // Markdown
                            markdown: { type: Type.STRING, description: "The markdown content as a string." }
                        }
                    }
                },
                required: ['type', 'data']
            }
        }
    },
    required: ['responses']
};


function constructPrompt(csvData: CSVData, prompt: string): string {
    const headers = csvData.headers.join(', ');
    // Take a sample of rows to avoid making the prompt too large
    const rowsSample = csvData.rows.slice(0, 10).map(row => 
        csvData.headers.map(header => row[header]).join(', ')
    ).join('\n');
    
    return `
        Analyze the following CSV data and answer the user's question.
        The data has ${csvData.rows.length} rows and the following columns: ${headers}.
        
        Here is a sample of the first 10 rows:
        ${rowsSample}
        
        User's Question: "${prompt}"
        
        Your task is to act as a data analyst. Based on the data and the user's question, generate a comprehensive response.
        The response must be in the specified JSON format and should consist of a list of UI blocks (cards, tables, charts, or markdown).
        - Use 'card' for single, important metrics or KPIs (e.g., Total Sales, Average Score).
        - Use 'table' to display detailed data, either raw or aggregated. Keep tables concise.
        - Use 'chart' to visualize trends, distributions, or comparisons. Choose the best chart type ('bar', 'pie', 'line', 'doughnut'). For chart colors, provide an array of hex color codes for 'backgroundColor'.
        - Use 'markdown' for textual explanations, insights, summaries, or to answer questions that don't require a visualization.
        - You can and should return multiple blocks of different types to create a rich, dashboard-like response. For example, a card with a key metric, a chart visualizing a trend, and a markdown block explaining the insight.
        - Always ensure the data you provide in the blocks is directly derived from the provided CSV data.
    `;
}


export async function generateInsights(csvData: CSVData, userPrompt: string): Promise<AIResponseBlock[]> {
    const prompt = constructPrompt(csvData, userPrompt);
    
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        
        const jsonText = response.text.trim();
        // The response might be wrapped in ```json ... ```
        const cleanJsonText = jsonText.replace(/^```json/, '').replace(/```$/, '').trim();
        const parsedJson = JSON.parse(cleanJsonText);

        if (!parsedJson.responses || !Array.isArray(parsedJson.responses)) {
            console.error("Invalid response format from AI:", parsedJson);
            throw new Error("AI response is not in the expected format.");
        }

        // Post-process the response to match the app's internal types
        const aiBlocks: AIResponseBlock[] = parsedJson.responses.map((block: any): AIResponseBlock | null => {
            if (!block.type || !block.data) return null;

            switch(block.type) {
                case 'markdown':
                    return {
                        type: 'markdown',
                        data: block.data.markdown || ''
                    };
                case 'chart': {
                    const chartData: ChartData = {
                        type: block.data.chartType,
                        labels: block.data.labels || [],
                        datasets: block.data.datasets || []
                    };
                    return { type: 'chart', data: chartData };
                }
                case 'card': {
                     const cardData: CardData = {
                        title: block.data.title || 'Untitled',
                        value: block.data.value || 'N/A',
                        description: block.data.description
                    };
                    return { type: 'card', data: cardData };
                }
                case 'table': {
                    const tableData: TableData = {
                        headers: block.data.headers || [],
                        rows: block.data.rows || []
                    };
                    return { type: 'table', data: tableData };
                }
                default:
                    return null;
            }
        }).filter((b): b is AIResponseBlock => b !== null);

        if (aiBlocks.length === 0) {
            return [{
                type: 'markdown',
                data: "I was unable to generate a valid visualization for your request. Please try rephrasing your question."
            }];
        }

        return aiBlocks;

    } catch (error) {
        console.error("Error generating insights from Gemini:", error);
        // Provide a user-friendly error message
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        return [{
            type: 'markdown',
            data: `Sorry, I encountered an error while analyzing the data.\n\n**Error:** ${errorMessage}\n\nPlease check the console for details and try again.`
        }];
    }
}
