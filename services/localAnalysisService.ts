import { AIResponseBlock, CSVData, TableData, CardData, ChartData } from '../types';

const handleUniqueCount = (column: string, data: CSVData): AIResponseBlock[] | null => {
    if (!data.headers.includes(column)) {
        return [{ type: 'markdown', data: `Error: Column '${column}' not found in the data.` }];
    }
    const uniqueValues = new Set(data.rows.map(row => row[column]).filter(Boolean)); // filter out empty/null values
    const count = uniqueValues.size;
    
    return [{
        type: 'card',
        data: {
            title: `Unique "${column}" Count`,
            value: count.toString(),
            description: `There are ${count} distinct non-empty values in the '${column}' column.`
        } as CardData
    }];
};

const handleDistribution = (column: string, data: CSVData): AIResponseBlock[] | null => {
    if (!data.headers.includes(column)) {
        return [{ type: 'markdown', data: `Error: Column '${column}' not found in the data.` }];
    }

    const counts: Record<string, number> = {};
    for (const row of data.rows) {
        const value = row[column] || 'N/A';
        counts[value] = (counts[value] || 0) + 1;
    }
    
    const sortedCounts = Object.entries(counts).sort(([, a], [, b]) => b - a);

    const tableData: TableData = {
        headers: [column, 'Count', 'Percentage'],
        rows: sortedCounts.map(([value, count]) => {
            const percentage = ((count / data.rows.length) * 100).toFixed(2) + '%';
            return [value, count, percentage];
        })
    };
    
    // Generate distinct colors for the chart
    const bgColors = sortedCounts.map((_, i) => `hsl(${(i * 360 / sortedCounts.length) % 360}, 55%, 55%)`);

    const chartData: ChartData = {
        type: sortedCounts.length > 5 ? 'bar' : 'pie',
        labels: sortedCounts.map(([value]) => value),
        datasets: [{
            label: `Distribution of ${column}`,
            data: sortedCounts.map(([, count]) => count),
            backgroundColor: bgColors
        }]
    };

    return [
        { type: 'markdown', data: `Here is the distribution for the **${column}** column.` },
        { type: 'chart', data: chartData },
        { type: 'table', data: tableData },
    ];
};

const handlePercentageOfValue = (value: string, column: string, data: CSVData): AIResponseBlock[] | null => {
    if (!data.headers.includes(column)) {
        return [{ type: 'markdown', data: `Error: Column '${column}' not found in the data.` }];
    }

    const totalRows = data.rows.length;
    if (totalRows === 0) {
        return [{ type: 'card', data: { title: `Percentage of ${value}`, value: '0%', description: 'No data to analyze.' } as CardData }];
    }

    const valueLower = value.toLowerCase();
    const matchingRows = data.rows.filter(row => (row[column] || '').toLowerCase() === valueLower).length;
    
    const percentage = (matchingRows / totalRows) * 100;

    return [{
        type: 'card',
        data: {
            title: `Percentage of "${value}" in ${column}`,
            value: `${percentage.toFixed(2)}%`,
            description: `${matchingRows} out of ${totalRows} rows had the value "${value}".`
        } as CardData
    }];
};


const PATTERNS = [
    { 
        regex: /(?:what is|calculate|find) (?:the )?percentage of ['"]?([^'"]+)['"]? in (?:the )?['"]?(\w+)['"]?/i,
        handler: handlePercentageOfValue
    },
    { 
        regex: /(?:count|number of) (?:unique|distinct) (?:values in|values of|of|records for) ['"]?(\w+)['"]?/i,
        handler: handleUniqueCount
    },
    {
        regex: /(?:show|get|calculate|find|create|generate) (?:the )?(?:distribution of|breakdown of|summary of) ['"]?(\w+)['"]?/i,
        handler: handleDistribution
    },
];

export function tryLocalAnalysis(prompt: string, data: CSVData): AIResponseBlock[] | null {
    for (const pattern of PATTERNS) {
        const match = prompt.match(pattern.regex);
        if (match) {
            const args = match.slice(1); // Get all capture groups
            console.log(`[Local Analysis] Matched pattern with args: ${args}`);
            // @ts-ignore
            return pattern.handler(...args, data);
        }
    }
    console.log('[Local Analysis] No pattern matched. Passing to AI.');
    return null;
}