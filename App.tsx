import React, { useState, useCallback, useRef, useEffect } from 'react';
import { getRequiredColumnsForQuery, getAIResponse } from './services/geminiService';
import type { ChatMessage, CSVData } from './types';
import Spinner from './components/Spinner';
import { LightBulbIcon, SendIcon, UploadIcon } from './components/icons';
import AIResponse from './components/MetricCard';

declare const Papa: any;

const toCSV = (headers: string[], rows: Record<string, string>[]) => {
    const headerRow = headers.join(',');
    const bodyRows = rows.map(row => headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(','));
    return [headerRow, ...bodyRows].join('\n');
};

const App: React.FC = () => {
  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (!csvData) {
        setChatHistory([]);
        setFileName('');
        setIsLoading(false);
    }
  }, [csvData]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setFileName(file.name);

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results: any) => {
            const headers = results.meta.fields || [];
            const rows = results.data;
            setCsvData({ headers, rows });
            
            const initialMessage: ChatMessage = {
                id: 'init',
                role: 'model',
                content: [{
                    type: 'markdown',
                    data: `Successfully loaded **${file.name}** with **${rows.length}** rows. I'm ready to analyze. What would you like to know?`
                }]
            };
            setChatHistory([initialMessage]);
            setIsLoading(false);
        },
        error: (error: any) => {
            const errorMessage: ChatMessage = {
                id: 'err-parse',
                role: 'model',
                content: [{
                    type: 'markdown',
                    data: `**Error:** Failed to parse the CSV file. Please ensure it's a valid CSV. \n*Details: ${error.message}*`
                }]
            };
            setChatHistory([errorMessage]);
            setIsLoading(false);
            setFileName('');
        }
    });
    event.target.value = ''; 
  };

  const handleSendMessage = useCallback(async (messageText?: string) => {
    const text = (messageText || userInput).trim();
    if (!text || isLoading || !csvData) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };
    
    const newHistory = [...chatHistory, userMessage];
    setChatHistory(newHistory);
    setUserInput('');
    setIsLoading(true);

    try {
      const requiredColumns = await getRequiredColumnsForQuery(text, csvData.headers);
      
      let contextualData: string;
      if (requiredColumns.length === 0) {
          contextualData = `The user's query doesn't seem to be about the data. The available columns are: [${csvData.headers.join(', ')}]. Engage in a friendly conversation.`;
      } else {
          const isSelectAll = requiredColumns[0] === '*';
          const headersToSend = isSelectAll ? csvData.headers : requiredColumns.filter(h => csvData.headers.includes(h));
          const dataRowsToSend = csvData.rows.map(row => {
              const newRow: Record<string, string> = {};
              headersToSend.forEach(col => { newRow[col] = row[col]; });
              return newRow;
          });
          
          contextualData = toCSV(headersToSend, dataRowsToSend);
          const MAX_ROWS = 500;
          if (dataRowsToSend.length > MAX_ROWS) {
            const truncatedData = toCSV(headersToSend, dataRowsToSend.slice(0, MAX_ROWS));
            contextualData = `${truncatedData}\n... and ${dataRowsToSend.length - MAX_ROWS} more rows. Analysis is based on the first ${MAX_ROWS} rows.`;
          }
      }

      const responseBlocks = await getAIResponse(newHistory, contextualData);
      const aiMessage: ChatMessage = { id: Date.now().toString() + 'ai', role: 'model', content: responseBlocks };
      setChatHistory(prev => [...prev, aiMessage]);
    } catch (err) {
      const errorMessage: ChatMessage = {
          id: Date.now().toString() + 'err',
          role: 'model',
          content: [{ type: 'markdown', data: '**Error:** Failed to get a response. Please try again.'}]
      };
      setChatHistory(prev => [...prev, errorMessage]);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [userInput, isLoading, chatHistory, csvData]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const suggestionPrompts = csvData
    ? [
        "Summarize this dataset.",
        `How many unique values in the '${csvData.headers[0]}' column?`,
        "Show me the first 5 rows.",
        "Are there any potential issues in this data?",
      ]
    : [];

  return (
    <div className="min-h-screen bg-base-100 flex flex-col items-center p-4 sm:p-2 font-sans">
      <div className="w-full max-w-3xl mx-auto flex flex-col h-[calc(100vh-1rem)]">
        <header className="text-center mb-4 flex-shrink-0">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-brand-secondary">
            Supply Chain AI Analyst
          </h1>
          <p className="mt-1 text-md text-content-200">
            Chat with your data to find discrepancies
          </p>
        </header>

        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 bg-base-200 rounded-t-lg border border-b-0 border-base-300 scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-base-200">
          {!csvData ? (
             <div className="flex flex-col items-center justify-center h-full text-center">
                <UploadIcon className="w-16 h-16 text-content-200" />
                <h2 className="mt-4 text-xl font-semibold">Upload Your Data</h2>
                <p className="mt-1 text-content-200">Upload a CSV file to start the analysis.</p>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv,text/csv" className="hidden" />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    className="mt-6 bg-brand-secondary text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-500 transition-colors disabled:bg-gray-500 flex items-center gap-2"
                >
                    {isLoading ? <Spinner className="w-5 h-5" /> : 'Select CSV File'}
                </button>
             </div>
          ) : (
            <div className="flex flex-col gap-4">
              {chatHistory.map((msg) => (
                <div key={msg.id} className={`flex gap-3 items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'model' && <div className="w-8 h-8 rounded-full bg-brand-secondary flex items-center justify-center flex-shrink-0 mt-1"><LightBulbIcon className="w-5 h-5 text-white" /></div>}
                  <div className={`max-w-lg lg:max-w-xl rounded-lg px-4 py-3 ${msg.role === 'user' ? 'bg-brand-primary text-white' : 'bg-base-300 text-content-100'}`}>
                    {typeof msg.content === 'string' ? <p>{msg.content}</p> : <AIResponse blocks={msg.content} />}
                  </div>
                </div>
              ))}
              {isLoading && (
                   <div className="flex gap-3 items-start justify-start">
                       <div className="w-8 h-8 rounded-full bg-brand-secondary flex items-center justify-center flex-shrink-0 mt-1"><LightBulbIcon className="w-5 h-5 text-white" /></div>
                       <div className="max-w-lg lg:max-w-xl rounded-lg px-4 py-3 bg-base-300 text-content-100 flex items-center justify-center">
                           <Spinner className="w-5 h-5" />
                       </div>
                   </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-base-200 p-4 rounded-b-lg border border-t-0 border-base-300 flex-shrink-0">
          {csvData && (
            <>
              {!isLoading && <div className="flex flex-wrap gap-2 mb-3">
                  {suggestionPrompts.map(prompt => (
                      <button 
                          key={prompt}
                          onClick={() => handleSendMessage(prompt)}
                          disabled={isLoading}
                          className="text-sm border border-base-300 rounded-full px-3 py-1 text-content-200 hover:bg-base-300 hover:text-content-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                          {prompt}
                      </button>
                  ))}
              </div>}
              <div className="flex items-center gap-3">
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isLoading ? "Analyzing..." : "Ask about your data..."}
                  rows={1}
                  disabled={isLoading}
                  className="flex-1 bg-base-300 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-brand-secondary text-content-100 disabled:opacity-70"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || !userInput.trim()}
                  className="bg-brand-secondary p-2.5 rounded-full text-white hover:bg-blue-500 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
                  aria-label="Send message"
                >
                  <SendIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="text-center mt-3">
                <button onClick={() => setCsvData(null)} className="text-xs text-content-200 hover:text-white underline">
                    Analyze another file
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
