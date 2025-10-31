
import React, { useEffect, useRef } from 'react';
import type { Chart } from 'chart.js/auto';
import { CardData, TableData, ChartData, AIResponseBlock } from '../types';

// Utility to parse markdown-like features
const parseMarkdown = (text: string) => {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.*?)\*/g, '<em>$1</em>')       // Italic
        .replace(/`([^`]+)`/g, '<code class="bg-base-100 px-1 rounded">$1</code>') // Inline code
        .replace(/\n/g, '<br />');                  // Newlines
}


const CardRenderer: React.FC<{ data: CardData }> = ({ data }) => {
    return (
        <div className="bg-base-300 p-4 rounded-lg shadow-md border border-base-100 mb-2">
            <h4 className="text-md font-semibold text-content-100">{data.title}</h4>
            <p className="text-3xl font-bold text-white my-1">{data.value}</p>
            {data.description && <p className="text-sm text-content-200">{data.description}</p>}
        </div>
    );
};

const TableRenderer: React.FC<{ data: TableData }> = ({ data }) => {
    return (
        <div className="overflow-x-auto rounded-lg border border-base-300 mb-2">
            <table className="min-w-full divide-y divide-base-300 bg-base-200">
                <thead className="bg-base-300">
                    <tr>
                        {data.headers.map((header, i) => (
                            <th key={i} scope="col" className="px-6 py-3 text-left text-xs font-medium text-content-200 uppercase tracking-wider">
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-base-300">
                    {data.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-base-300">
                            {row.map((cell, j) => (
                                <td key={j} className="px-6 py-4 whitespace-nowrap text-sm text-content-100">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ChartRenderer: React.FC<{ data: ChartData }> = ({ data }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        
        if (chartRef.current) {
            chartRef.current.destroy();
        }

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        chartRef.current = new (window as any).Chart(ctx, {
            type: data.type,
            data: {
                labels: data.labels,
                datasets: data.datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#9ca3af', // content-200
                        }
                    }
                },
                scales: data.type === 'bar' || data.type === 'line' ? {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#9ca3af' },
                        grid: { color: '#4b5563' } // base-300
                    },
                    x: {
                        ticks: { color: '#9ca3af' },
                        grid: { color: 'transparent' }
                    }
                } : {}
            }
        });

        return () => {
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }
        };
    }, [data]);

    return (
        <div className="bg-base-200 p-4 rounded-lg shadow-md border border-base-300 mb-2 relative h-80">
            <canvas ref={canvasRef}></canvas>
        </div>
    );
};

const MarkdownRenderer: React.FC<{ data: string }> = ({ data }) => {
    return (
        <div 
            className="text-content-100 leading-relaxed prose"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(data) }}
        ></div>
    );
};

const AIResponse: React.FC<{ blocks: AIResponseBlock[] }> = ({ blocks }) => {
    return (
        <div className="flex flex-col gap-2">
            {blocks.map((block, index) => {
                const key = `block-${index}`;
                switch (block.type) {
                    case 'card':
                        return <CardRenderer key={key} data={block.data as CardData} />;
                    case 'table':
                        return <TableRenderer key={key} data={block.data as TableData} />;
                    case 'chart':
                        return <ChartRenderer key={key} data={block.data as ChartData} />;
                    case 'markdown':
                        return <MarkdownRenderer key={key} data={block.data as string} />;
                    default:
                        return <div key={key}>Unsupported block type</div>;
                }
            })}
        </div>
    );
};

export default AIResponse;
