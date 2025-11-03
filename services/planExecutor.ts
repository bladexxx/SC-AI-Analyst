import { CSVData, ExecutionPlan } from '../types';

interface ExecutionResult {
    metrics: Record<string, any>;
    subset: CSVData;
}

/**
 * Executes a structured plan against the provided dataset.
 * This involves filtering the data and running local calculations.
 * @param plan - The execution plan from the pre-analysis AI.
 * @param data - The full CSV dataset.
 * @returns An object containing calculated metrics and the filtered data subset.
 */
export const executePlan = (plan: ExecutionPlan, data: CSVData): ExecutionResult => {
    let filteredRows = [...data.rows];

    // 1. Apply Filters
    if (plan.filters) {
        for (const filter of plan.filters) {
            filteredRows = filteredRows.filter(row => {
                const cellValue = (row[filter.column] || '').toLowerCase();
                const filterValue = (String(filter.value) || '').toLowerCase();

                switch (filter.operator) {
                    case 'equals':
                        return cellValue === filterValue;
                    case 'not_equals':
                        return cellValue !== filterValue;
                    case 'contains':
                        return cellValue.includes(filterValue);
                    case 'is_empty':
                        return !cellValue;
                    case 'is_not_empty':
                        return !!cellValue;
                    default:
                        return true;
                }
            });
        }
    }

    // 2. Perform Calculations
    const metrics: Record<string, any> = {};
    if (plan.calculations) {
        const total = filteredRows.length;
        for (const calc of plan.calculations) {
            if (total === 0) {
                metrics[calc] = 0;
                continue;
            }
            switch (calc) {
                case 'count':
                    metrics.count = total;
                    break;
                case 'mismatch_rate':
                    const mismatches = filteredRows.filter(r => r.tracking_no !== r.vend_track_no && r.vend_track_no).length;
                    metrics.mismatch_rate = (mismatches / total) * 100;
                    break;
                case 'missing_po_rate':
                    const missingPos = filteredRows.filter(r => !r.return_po).length;
                    metrics.missing_po_rate = (missingPos / total) * 100;
                    break;
            }
        }
    }
    
    const subset: CSVData = {
        headers: data.headers, // For simplicity, keep all headers for now
        rows: filteredRows
    };

    return { metrics, subset };
}
