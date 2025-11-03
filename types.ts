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

// --- New types for the Hybrid Analysis Execution Plan ---

export interface Filter {
  column: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty';
  value?: string | number;
}

export type CalculationType = 'mismatch_rate' | 'missing_po_rate' | 'count';

export interface ExecutionPlan {
  action: 'direct_analysis' | 'filter_and_analyze';
  filters?: Filter[];
  calculations?: CalculationType[];
  data_subset_columns?: string[];
}
