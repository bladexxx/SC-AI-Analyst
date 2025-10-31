import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CSVData, ChatMessage } from './types';
import { generateInsights } from './services/geminiService';
import AIResponse from './components/MetricCard';
import Spinner from './components/Spinner';
import { UploadIcon, CheckCircleIcon, ChartBarIcon, SendIcon, LightBulbIcon } from './components/icons';

const App: React.FC = () => {
  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const parseCSV = (file: File): Promise<CSVData> => {
    return new Promise((resolve, reject) => {
      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        return reject(new Error("Invalid file type. Please upload a CSV file."));
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split(/[\r\n]+/).filter(line => line.trim() !== '');
          if (lines.length < 2) {
            return reject(new Error("CSV must have a header and at least one data row."));
          }
          const headers = lines[0].split(',').map(h => h.trim());
          const rows = lines.slice(1).map(line => {
            // A simple parser, may not handle commas in quotes correctly.
            // For robust parsing, a library like PapaParse would be better in a real app.
            const values = line.split(',');
            const rowObject: Record<string, string> = {};
            headers.forEach((header, index) => {
              rowObject[header] = values[index]?.trim() || '';
            });
            return rowObject;
          });
          resolve({ headers, rows });
        } catch (err) {
          reject(new Error("Failed to parse the CSV file."));
        }
      };
      reader.onerror = () => reject(new Error("Error reading file."));
      reader.readAsText(file);
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setError(null);
      setIsLoading(true);
      setFileName(file.name);
      try {
        const data = await parseCSV(file);
        setCsvData(data);
        setMessages([
          {
            id: 'initial-message',
            role: 'model',
            content: [{
              type: 'markdown',
              data: `Successfully loaded **${file.name}** with **${data.rows.length}** rows. What insights are you looking for?`
            }]
          }
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        setFileName('');
        setCsvData(null);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSubmit = useCallback(async (prompt: string) => {
    if (!prompt.trim() || !csvData || isLoading) return;

    setIsLoading(true);
    setUserInput('');

    const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: prompt };
    setMessages(prev => [...prev, userMessage]);

    try {
      const aiBlocks = await generateInsights(csvData, prompt);
      const modelMessage: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', content: aiBlocks };
      setMessages(prev => [...prev, modelMessage]);
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: [{ type: 'markdown', data: `**Error:** ${err instanceof Error ? err.message : 'An unexpected error occurred.'}` }]
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [csvData, isLoading]);
  
  const examplePrompts = [
    "Give me a summary of the dataset.",
    "What are the key metrics?",
    "Show me a breakdown of sales by region.",
    "Visualize the distribution of customer ratings.",
  ];

  if (!csvData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-base-200 p-4">
        <div className="max-w-lg w-full text-center p-8 bg-base-100 rounded-2xl shadow-2xl">
          <ChartBarIcon className="w-16 h-16 mx-auto text-primary" />
          <h1 className="text-4xl font-bold mt-4">Data Insight Explorer</h1>
          <p className="text-content-200 mt-2 mb-6">
            Upload a CSV file to start exploring your data with AI-powered visualizations and insights.
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
            ref={fileInputRef}
            disabled={isLoading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary btn-lg w-full"
            disabled={isLoading}
          >
            {isLoading ? <Spinner /> : <><UploadIcon className="w-6 h-6 mr-2" /> Upload CSV</>}
          </button>
          {error && <p className="text-error mt-4">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-base-200">
      <header className="bg-base-100/80 backdrop-blur-sm p-3 border-b border-base-300 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
            <CheckCircleIcon className="w-6 h-6 text-success"/>
            <span className="font-semibold text-content-100">{fileName}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setCsvData(null); setMessages([]); setFileName(''); setError(null); }}>
          Upload New File
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message) => (
            <div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
              <div className="chat-bubble prose max-w-none break-words">
                {typeof message.content === 'string' ? (
                  <p>{message.content}</p>
                ) : (
                  <AIResponse blocks={message.content} />
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="chat chat-start">
                <div className="chat-bubble prose max-w-none">
                   <div className="flex items-center gap-2">
                        <Spinner className="w-5 h-5" />
                        <span>Analyzing...</span>
                   </div>
                </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="bg-base-100 p-4 md:p-6 border-t border-base-300">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
              <LightBulbIcon className="w-5 h-5 text-warning" />
              <h3 className="text-sm font-semibold">Example Prompts</h3>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
              {examplePrompts.map(p => (
                <button key={p} onClick={() => handleSubmit(p)} className="btn btn-xs btn-outline" disabled={isLoading}>
                  {p}
                </button>
              ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(userInput); }} className="flex gap-2">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Ask about your data..."
              className="input input-bordered w-full"
              disabled={isLoading}
            />
            <button type="submit" className="btn btn-primary" disabled={isLoading || !userInput.trim()}>
              {isLoading ? <Spinner className="w-5 h-5"/> : <SendIcon className="w-5 h-5"/>}
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
};

export default App;
