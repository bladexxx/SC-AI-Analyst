import { AIResponseBlock, CSVData, TableData, CardData, ChartData } from '../types';

const handleUniqueCount = (column: string, data: CSVData): AIResponseBlock[] | null => {
    // Sanitize the column name, removing potential quotes or extra characters from regex
    const cleanColumn = column.replace(/['"`]/g, '').trim();

    if (!data.headers.includes(cleanColumn)) {
        return [{ type: 'markdown', data: `Error: Column '${cleanColumn}' not found in the data.` }];
    }
    const uniqueValues = new Set(data.rows.map(row => row[cleanColumn]).filter(val => val !== null && val !== undefined && val !== ''));
    const count = uniqueValues.size;
    
    return [{
        type: 'card',
        data: {
            title: `Unique "${cleanColumn}" Count`,
            value: count.toString(),
            description: `There are ${count} distinct non-empty values in the '${cleanColumn}' column.`
        } as CardData
    }];
};

const handleDistribution = (column: string, data: CSVData): AIResponseBlock[] | null => {
    const cleanColumn = column.replace(/['"`]/g, '').trim();

    if (!data.headers.includes(cleanColumn)) {
        return [{ type: 'markdown', data: `Error: Column '${cleanColumn}' not found in the data.` }];
    }

    const counts: Record<string, number> = {};
    for (const row of data.rows) {
        const value = row[cleanColumn] || 'N/A';
        counts[value] = (counts[value] || 0) + 1;
    }
    
    const sortedCounts = Object.entries(counts).sort(([, a], [, b]) => b - a);

    const tableData: TableData = {
        headers: [cleanColumn, 'Count', 'Percentage'],
        rows: sortedCounts.map(([value, count]) => {
            const percentage = ((count / data.rows.length) * 100).toFixed(2) + '%';
            return [value, count, percentage];
        })
    };
    
    const bgColors = sortedCounts.map((_, i) => `hsl(${(i * 360 / Math.min(sortedCounts.length, 20)) % 360}, 55%, 55%)`);

    const chartData: ChartData = {
        type: sortedCounts.length > 5 ? 'bar' : 'pie',
        labels: sortedCounts.map(([value]) => value),
        datasets: [{
            label: `Distribution of ${cleanColumn}`,
            data: sortedCounts.map(([, count]) => count),
            backgroundColor: bgColors
        }]
    };

    return [
        { type: 'markdown', data: `Here is the distribution for the **${cleanColumn}** column.` },
        { type: 'chart', data: chartData },
        { type: 'table', data: tableData },
    ];
};

const handleContainmentPercentage = (col1: string, col2: string, data: CSVData): AIResponseBlock[] | null => {
    const cleanCol1 = col1.replace(/['"`]/g, '').trim();
    const cleanCol2 = col2.replace(/['"`]/g, '').trim();

    if (!data.headers.includes(cleanCol1) || !data.headers.includes(cleanCol2)) {
        let missing = [];
        if (!data.headers.includes(cleanCol1)) missing.push(cleanCol1);
        if (!data.headers.includes(cleanCol2)) missing.push(cleanCol2);
        return [{ type: 'markdown', data: `Error: Column(s) '${missing.join(', ')}' not found.` }];
    }

    const totalRows = data.rows.length;
    if (totalRows === 0) {
        return [{ type: 'card', data: { title: `Containment Percentage`, value: '0%', description: 'No data to analyze.' } as CardData }];
    }
    
    let containedCount = 0;
    for (const row of data.rows) {
        const val1 = row[cleanCol1] || '';
        const val2 = row[cleanCol2] || '';
        if (val1 && val2 && val1.includes(val2)) {
            containedCount++;
        }
    }
    
    const percentage = (containedCount / totalRows) * 100;

    return [{
        type: 'card',
        data: {
            title: `"${cleanCol1}" containing "${cleanCol2}"`,
            value: `${percentage.toFixed(2)}%`,
            description: `${containedCount} of ${totalRows} rows showed that the '${cleanCol1}' value contained the '${cleanCol2}' value.`
        } as CardData
    }];
};

// More robust patterns that accept English and Chinese keywords, and flexible column names.
const PATTERNS = [
    // Matches: "percentage of tracking_no that contains vend_track_no", "tracking_no 包含 vend_track_no 的比例"
    { 
        regex: /(?:what is|calculate|find) (?:the )?percentage of ['"]?([\w_]+)['"]? (?:that contains|containing|里有多少比例包含了) ['"]?([\w_]+)['"]?/i,
        handler: handleContainmentPercentage
    },
    { 
        regex: /['"]?([\w_]+)['"]? (?:里有多少比例包含了|containing|contains) ['"]?([\w_]+)['"]? (?:的比例|percentage)/i,
        handler: handleContainmentPercentage
    },
    // Matches: "count unique tracking_no", "unique tracking_no 的数量", "统计 unique vend_track_no"
    { 
        regex: /(?:count|number of|统计) (?:unique|distinct) ['"]?([\w_]+)['"]?/i,
        handler: handleUniqueCount
    },
    {
        regex: /(?:unique|distinct) ['"]?([\w_]+)['"]? (?:of|的数量|数量)/i,
        handler: handleUniqueCount
    },
    // Matches: "show distribution of carrier", "carrier 的分布"
    {
        regex: /(?:show|get|calculate|find|create|generate) (?:the )?(?:distribution of|breakdown of|summary of|分布) ['"]?([\w_]+)['"]?/i,
        handler: handleDistribution
    },
    {
        regex: /['"]?([\w_]+)['"]? (?:的分布|distribution)/i,
        handler: handleDistribution
    },
];

export function tryLocalAnalysis(prompt: string, data: CSVData): AIResponseBlock[] | null {
    const cleanPrompt = prompt.toLowerCase().trim();
    for (const pattern of PATTERNS) {
        const match = cleanPrompt.match(pattern.regex);
        if (match) {
            const args = match.slice(1); // Get all capture groups
            console.log(`[Local Analysis] Matched pattern '${pattern.regex.source}' with args: ${args}`);
            // @ts-ignore
            return pattern.handler(...args, data);
        }
    }
    console.log('[Local Analysis] No pattern matched. Passing to AI.');
    return null;
}