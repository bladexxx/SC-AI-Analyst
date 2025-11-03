import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage, CSVData, AIResponseBlock, KnowledgeFile } from './types';
import { generateInsights } from './services/geminiService';
import { tryLocalAnalysis } from './services/localAnalysisService';
import AIResponse from './components/MetricCard';
import Spinner from './components/Spinner';
import { UploadIcon, LightBulbIcon, SendIcon, ChartBarIcon, BookOpenIcon } from './components/icons';
import KnowledgeBaseModal from './components/KnowledgeBaseModal';

// Add this declaration to inform TypeScript about the XLSX library from the CDN
declare var XLSX: any;

const parseSampleCSV = (csvText: string): CSVData => {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    // A more robust way to handle commas inside quoted fields
    const values = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    return headers.reduce((obj, header, index) => {
      obj[header] = (values[index] || '').replace(/"/g, '').trim();
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

const KNOWLEDGE_STORAGE_KEY = 'supplyChainAI_knowledgeBase';

const App: React.FC = () => {
  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load knowledge files from localStorage on initial render
  useEffect(() => {
    try {
      const storedFiles = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
      if (storedFiles) {
        setKnowledgeFiles(JSON.parse(storedFiles));
      }
    } catch (e) {
      console.error("Failed to load knowledge files from localStorage", e);
    }
  }, []);
  
  // Save knowledge files to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(knowledgeFiles));
    } catch (e) {
      console.error("Failed to save knowledge files to localStorage", e);
    }
  }, [knowledgeFiles]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAddKnowledgeFiles = (newFiles: KnowledgeFile[]) => {
    setKnowledgeFiles(prevFiles => {
      const existingFileNames = new Set(prevFiles.map(f => f.name));
      const uniqueNewFiles = newFiles.filter(nf => !existingFileNames.has(nf.name));
      return [...prevFiles, ...uniqueNewFiles];
    });
  };

  const handleRemoveKnowledgeFile = (fileName: string) => {
    setKnowledgeFiles(prevFiles => prevFiles.filter(f => f.name !== fileName));
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          if (!e.target?.result) {
              throw new Error("File is empty or could not be read.");
          }
          const data = new Uint8Array(e.target.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          if (jsonData.length < 2) {
            throw new Error("Excel file must have a header row and at least one data row.");
          }

          const headers = jsonData[0].map(String);
          const rows = jsonData.slice(1).map(rowData => {
            return headers.reduce((obj, header, index) => {
              obj[header] = rowData[index] !== undefined ? String(rowData[index]) : '';
              return obj;
            }, {} as Record<string, string>);
          });

          const parsedData = { headers, rows };

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
          setError('Failed to parse Excel file. Please ensure it is a valid .xlsx file with a header row.');
          setFileName('');
          setCsvData(null);
        }
      };
      reader.onerror = () => {
        setError('Failed to read the file.');
      }
      reader.readAsArrayBuffer(file);
    }
  };
  
  const handleLoadSampleData = () => {
    try {
      const sampleFileName = 'sample_asn_data.xlsx';
      setFileName(sampleFileName);
      const parsedData = parseSampleCSV(sampleCSVData);
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

    // --- LOCAL ANALYSIS STEP ---
    const localAnalysisResult = tryLocalAnalysis(messageText, csvData);
    
    if (localAnalysisResult) {
        const modelMessage: ChatMessage = {
            id: `model-local-${Date.now()}`,
            role: 'model',
            content: localAnalysisResult,
        };
        setMessages(prev => [...prev, modelMessage]);
        setIsLoading(false);
        return; // Exit before calling AI
    }
    // --- END LOCAL ANALYSIS ---


    try {
      const knowledgeContent = knowledgeFiles
        .map(f => `--- KNOWLEDGE FILE: ${f.name} ---\n${f.content}`)
        .join('\n\n');
        
      const aiResponseBlocks = await generateInsights(csvData, messageText, knowledgeContent);
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
    "Find tracking number mismatches.",
    "Show distribution of carrier.",
    "Count unique values of api_source.",
    "Show me shipments that are missing a PO number.",
  ];

  return (
    <div className="flex flex-col h-screen font-sans">
      <header className="bg-base-200 border-b border-base-300 p-4 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChartBarIcon className="w-8 h-8 text-brand-secondary" />
            <h1 className="text-xl font-bold text-white">Supply Chain AI Analyst</h1>
          </div>
          <button
            onClick={() => setIsKnowledgeModalOpen(true)}
            className="relative bg-base-300 text-content-100 font-semibold py-2 px-4 rounded-lg hover:bg-base-100 transition-colors flex items-center gap-2"
          >
            <BookOpenIcon className="w-5 h-5"/>
            Manage Knowledge
            {knowledgeFiles.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-brand-secondary text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                {knowledgeFiles.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-5xl mx-auto h-full">
          {!csvData ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-full max-w-lg text-center">
                <h2 className="text-2xl font-semibold mb-2 text-white">Analyze Your Supply Chain Data</h2>
                <p className="text-content-200 mb-6">Upload an Excel file (.xlsx) or use our sample data to get started.</p>
                
                <div 
                  className="border-2 border-dashed border-base-300 rounded-lg p-8 cursor-pointer hover:border-brand-secondary hover:bg-base-200 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
                  <UploadIcon className="mx-auto w-12 h-12 text-content-200 mb-4" />
                  <p className="text-content-100">Click to browse or drag & drop an Excel file here</p>
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
                           <span className="text-content-100">{userInput.toLowerCase().includes('distribution') || userInput.toLowerCase().includes('count') ? 'Calculating...' : 'Analyzing...'}</span>
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
      <KnowledgeBaseModal 
        isOpen={isKnowledgeModalOpen}
        onClose={() => setIsKnowledgeModalOpen(false)}
        files={knowledgeFiles}
        onAddFiles={handleAddKnowledgeFiles}
        onRemoveFile={handleRemoveKnowledgeFile}
      />
    </div>
  );
};

export default App;