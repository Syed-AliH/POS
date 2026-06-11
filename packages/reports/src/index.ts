export interface DailySalesReport {
  date: string;
  totalSales: number;
  transactionCount: number;
}

export function formatDailySalesReport(report: DailySalesReport, currency = 'PKR'): string {
  return [
    'DAILY SALES REPORT',
    `Date: ${report.date}`,
    `Transactions: ${report.transactionCount}`,
    `Total Sales: ${currency} ${report.totalSales.toFixed(2)}`,
  ].join('\n');
}

export interface ProfitReportData {
  revenue: number;
  estimatedCost: number;
  grossProfit: number;
  marginPercent: number;
}

export function formatProfitReport(report: ProfitReportData, currency = 'PKR'): string {
  return [
    'PROFIT REPORT',
    `Revenue: ${currency} ${report.revenue.toFixed(2)}`,
    `Est. Cost: ${currency} ${report.estimatedCost.toFixed(2)}`,
    `Gross Profit: ${currency} ${report.grossProfit.toFixed(2)}`,
    `Margin: ${report.marginPercent.toFixed(1)}%`,
  ].join('\n');
}
