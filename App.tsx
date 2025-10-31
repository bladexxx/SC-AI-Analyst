import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage, CSVData, AIResponseBlock } from './types';
import { generateInsights } from './services/geminiService';
import AIResponse from './components/MetricCard';
import Spinner from './components/Spinner';
import { UploadIcon, CheckCircleIcon, LightBulbIcon, SendIcon, ChartBarIcon } from './components/icons';

const parseCSV = (csvText: string): CSVData => {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index];
      return obj;
    }, {} as Record<string, string>);
  });
  return { headers, rows };
};

const sampleCSVData = `loc_no,vend_no,vend_code,order_no,carrier,pack_list_no,rec_date,tracking_no,vend_track_no,api_source,return_po,week_period,week_begin,run_date
101,5001,VEND-A,PO12345,UPS,PL54321,2023-10-26,1Z999AA10123456789,1Z999AA10123456789,EDI,PO12345,43,2023-10-23,2023-10-27
102,5002,VEND-B,PO12346,FEDEX,PL54322,2023-10-26,781234567890,781234567890,API,PO12346,43,2023-10-23,2023-10-27
101,5001,VEND-A,PO12347,UPS,PL54323,2023-10-27,1Z999AA10123456790,1Z999AA10123456791,EDI,,43,2023-10-23,2023-10-27
103,5003,VEND-C,PO12348,USPS,PL54324,2023-10-27,9400100000000000000000,9400100000000000000000,EDI,PO12348,43,2023-10-23,2023-10-27
102,5002,VEND-B,PO12349,FEDEX,PL54325,2023-10-28,781234567891,781234567892,API,PO12349,44,2023-10-30,2023-10-27
101,5001,VEND-A,PO12350,UPS,PL54326,2023-10-28,1Z999AA10123456792,1Z999AA10123456792,API,PO12350,44,2023-10-30,2023-10-27
101,5004,VEND-D,PO12351,UPS,PL54327,2023-10-29,1Z999AA10123456793,1Z999BB10123456793,EDI,PO12351,44,2023-10-30,2023-10-27
102,5002,VEND-B,PO12352,FEDEX,PL54328,2023-10-29,781234567893,,API,,44,2023-10-30,2023-10-27`;


const App: React.FC = () => {
  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          if (!text) {
              throw new Error("File is empty.");
          }
          const parsedData = parseCSV(text);
          setCsvData(parsedData);
          setMessages([
            {
              id: Date.now().toString(),
              role: 'model',
              content: [{
                type: 'markdown',
                data: `Successfully loaded **${file.name}**. I'm ready to answer your questions about the data.`
              }]
            }
          ]);
          setError('');
        } catch (err) {
          setError('Failed to parse CSV file. Please ensure it is correctly formatted.');
          setFileName('');
          setCsvData(null);
        }
      };
      reader.onerror = () => {
        setError('Failed to read the file.');
      }
      reader.readAsText(file);
    }
  };
  
  const handleLoadSampleData = () => {
    try {
      const sampleFileName = 'sample_asn_data.csv';
      setFileName(sampleFileName);
      const parsedData = parseCSV(sampleCSVData);
      setCsvData(parsedData);
      setMessages([
        {
          id: Date.now().toString(),
          role: 'model',
          content: [{
            type: 'markdown',
            data: `Successfully loaded **${sampleFileName}**. This data shows Advanced Shipment Notice (ASN) information. I can help you find discrepancies and analyze performance.`
          }]
        }
      ]);
      setError('');
    } catch (err) {
      setError('Failed to parse the sample data. This is an internal error.');
      setFileName('');
      setCsvData(null);
    }
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading || !csvData) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
    };
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsLoading(true);

    try {
      const aiResponseBlocks = await generateInsights(csvData, messageText);
      const modelMessage: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        content: aiResponseBlocks,
      };
      setMessages(prev => [...prev, modelMessage]);
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'model',
        content: [{
          type: 'markdown',
          data: 'Sorry, I encountered an error. Please try again.'
        }]
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }

  const handleSendMessage = () => {
      sendMessage(userInput);
  };
  
  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const suggestionPrompts = [
    "Give me a summary of this data.",
    "Find tracking number mismatches.",
    "Show me shipments that are missing a PO number.",
    "Summarize shipments by carrier.",
  ];

  return (
    <div className="flex flex-col h-screen font-sans">
      <header className="bg-base-200 border-b border-base-300 p-4 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <ChartBarIcon className="w-8 h-8 text-brand-secondary" />
          <h1 className="text-xl font-bold text-white">Supply Chain AI Analyst</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-5xl mx-auto h-full">
          {!csvData ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-full max-w-lg text-center">
                <h2 className="text-2xl font-semibold mb-2 text-white">Analyze Your Supply Chain Data</h2>
                <p className="text-content-200 mb-6">Upload a CSV file or use our sample data to get started.</p>
                
                <div 
                  className="border-2 border-dashed border-base-300 rounded-lg p-8 cursor-pointer hover:border-brand-secondary hover:bg-base-200 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />
                  <UploadIcon className="mx-auto w-12 h-12 text-content-200 mb-4" />
                  <p className="text-content-100">Click to browse or drag & drop a CSV file here</p>
                </div>

                <div className="my-4 text-content-200">OR</div>
                
                <button
                  onClick={handleLoadSampleData}
                  className="bg-brand-secondary text-white font-bold py-3 px-4 rounded-lg hover:bg-brand-primary transition-colors flex items-center justify-center w-full"
                >
                  Load Sample Data
                </button>
                
                {error && (
                  <div className="mt-4 text-red-400">
                    {error}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="flex-1 space-y-6 pb-4">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'model' && (
                       <div className="w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center flex-shrink-0 mt-2">
                           <LightBulbIcon className="w-5 h-5 text-white" />
                       </div>
                    )}
                    <div className={`rounded-lg p-3 max-w-2xl ${msg.role === 'user' ? 'bg-brand-secondary text-white' : 'bg-base-200'}`}>
                      {typeof msg.content === 'string' ? (
                         <p>{msg.content}</p>
                      ) : (
                         <AIResponse blocks={msg.content as AIResponseBlock[]} />
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                   <div className="flex items-start gap-3">
                       <div className="w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center flex-shrink-0 mt-2">
                           <LightBulbIcon className="w-5 h-5 text-white" />
                       </div>
                       <div className="bg-base-200 rounded-lg p-4 flex items-center gap-2">
                          <Spinner />
                          <span className="text-content-100">Analyzing...</span>
                       </div>
                   </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}
        </div>
      </main>
      
      {csvData && (
        <footer className="bg-base-100 border-t border-base-200 p-4">
          <div className="max-w-5xl mx-auto">
            {messages.length <= 1 && (
                <div className="flex flex-wrap gap-2 mb-3">
                    {suggestionPrompts.map((prompt, i) => (
                        <button
                            key={i}
                            onClick={() => handleSuggestionClick(prompt)}
                            className="text-sm bg-base-200 hover:bg-base-300 text-content-100 px-3 py-1.5 rounded-full transition-colors"
                            disabled={isLoading}
                        >
                            {prompt}
                        </button>
                    ))}
                </div>
            )}
            <div className="relative">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                placeholder="Ask a question about your data..."
                className="w-full bg-base-200 border border-base-300 rounded-lg py-3 pl-4 pr-12 text-content-100 focus:outline-none focus:ring-2 focus:ring-brand-secondary"
                disabled={isLoading}
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || !userInput.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-brand-secondary text-white disabled:bg-base-300 disabled:text-content-200 hover:bg-brand-primary transition-colors"
                aria-label="Send message"
              >
                <SendIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
