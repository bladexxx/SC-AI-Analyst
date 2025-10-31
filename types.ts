export interface CardData {
  title: string;
  value: string;
  description?: string;
}

export interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string[];
}

export interface ChartData {
  type: 'bar' | 'pie' | 'line' | 'doughnut';
  labels: string[];
  datasets: ChartDataset[];
}

// A single block of content in an AI response
export interface AIResponseBlock {
  type: 'card' | 'table' | 'chart' | 'markdown';
  data: CardData | TableData | ChartData | string;
}

// A message in the chat history
export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string | AIResponseBlock[];
}

// Represents a parsed CSV file
export interface CSVData {
  headers: string[];
  rows: Record<string, string>[];
}

// Represents an uploaded knowledge file
export interface KnowledgeFile {
  name: string;
  content: string;
}
