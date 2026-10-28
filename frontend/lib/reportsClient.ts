import * as XLSX from 'xlsx';
import { authClient } from './authClient';

export type ReportCategoryKey = 'seller' | 'rfq' | 'buyer' | 'daily_activity';

export interface ReportConfig {
  id: string;
  category: ReportCategoryKey;
  label: string;
  description: string;
  endpoint: string;
  requestType?: string;
  defaultFileName: string;
}

export const REPORT_OPTIONS: ReportConfig[] = [
  // Seller Reports
  {
    id: 'seller_detailed',
    category: 'seller',
    label: 'Detailed Seller & RFQ Interaction Report',
    description: 'Complete log of vendor assignments, quotation submissions, and RFQ activity with sourcing modes.',
    endpoint: '/api/reports/seller-report',
    requestType: 'sellerReport',
    defaultFileName: 'Seller_Detailed_Report',
  },
  {
    id: 'seller_summary',
    category: 'seller',
    label: 'Seller Summary & Onboarding Report',
    description: 'Summary of vendor registrations, subscription tiers, logins, and category presence.',
    endpoint: '/api/reports/seller-report',
    requestType: 'sellerSummary',
    defaultFileName: 'Seller_Summary_Report',
  },
  {
    id: 'seller_categories',
    category: 'seller',
    label: 'Seller Category Mapping Matrix',
    description: 'Comprehensive mapping of major and minor procurement categories across all active vendors.',
    endpoint: '/api/reports/seller-report',
    requestType: 'sellerCategoryReport',
    defaultFileName: 'Seller_Category_Mapping',
  },
  {
    id: 'seller_subscriptions',
    category: 'seller',
    label: 'Seller Subscription & Credit Utilization',
    description: 'Vendor quote credits, RFQ downloads used, and subscription plan entitlements.',
    endpoint: '/api/reports/seller-report',
    requestType: 'sellerSubscriptionReport',
    defaultFileName: 'Seller_Subscriptions_Report',
  },

  // RFQ Reports
  {
    id: 'rfq_detailed',
    category: 'rfq',
    label: 'RFQ Performance & Turnaround Report',
    description: 'Turnaround metrics, first quote response times, awarded values, and sourcing modes.',
    endpoint: '/api/reports/rfq-report',
    requestType: 'rfqReport',
    defaultFileName: 'RFQ_Performance_Report',
  },
  {
    id: 'rfq_summary',
    category: 'rfq',
    label: 'RFQ Quotation Summary Report',
    description: 'Item-level quotes, vendor pricing, remarks, and forwarding dates for each RFQ.',
    endpoint: '/api/reports/rfq-report',
    requestType: 'rfqSummaryReport',
    defaultFileName: 'RFQ_Quotation_Summary',
  },
  {
    id: 'rfq_dispatch',
    category: 'rfq',
    label: 'Daily RFQ Dispatch & AI Chaser Log',
    description: 'Status of active AI chasing, budget indicators, and vendor assignment counts.',
    endpoint: '/api/reports/rfq-report',
    requestType: 'dailyRfqDispatchReport',
    defaultFileName: 'Daily_RFQ_Dispatch_Report',
  },

  // Buyer Reports
  {
    id: 'buyer_detailed',
    category: 'buyer',
    label: 'Buyer Requisitions & RFQ Report',
    description: 'Detailed list of RFQs created by enterprise buyers, item descriptions, and categories.',
    endpoint: '/api/reports/buyer-report',
    requestType: 'buyerReport',
    defaultFileName: 'Buyer_Requisitions_Report',
  },
  {
    id: 'buyer_summary',
    category: 'buyer',
    label: 'Buyer Summary & Spend Analytics',
    description: 'Enterprise organization metrics, total spend, sourcing mode versions, and verification status.',
    endpoint: '/api/reports/buyer-report',
    requestType: 'buyerSummary',
    defaultFileName: 'Buyer_Summary_Spend_Report',
  },
  {
    id: 'buyer_categories',
    category: 'buyer',
    label: 'Buyer Category Alignment Report',
    description: 'Major procurement categories supported by each buyer account and plant locations.',
    endpoint: '/api/reports/buyer-report',
    requestType: 'buyerCategoryReport',
    defaultFileName: 'Buyer_Category_Alignment',
  },
  {
    id: 'buyer_credits',
    category: 'buyer',
    label: 'Buyer Quota & Free Trial Report',
    description: 'Remaining free RFQ allowances, consumed credits, and subscription tier details.',
    endpoint: '/api/reports/buyer-report',
    requestType: 'buyerCreditsReport',
    defaultFileName: 'Buyer_Credits_Report',
  },

  // Daily Activity Reports
  {
    id: 'daily_activity',
    category: 'daily_activity',
    label: 'Daily Operations Activity Report',
    description: 'System-wide summary of daily RFQs, active suppliers, dispatched requisitions, and audit actions.',
    endpoint: '/api/reports/daily-activity',
    defaultFileName: 'Daily_Operations_Activity_Report',
  },
];

export async function fetchReportData(
  reportConfig: ReportConfig,
  startDate?: string,
  endDate?: string,
  limit?: number
): Promise<{ success: boolean; data?: any[]; summary?: any; totalRecords?: number; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (reportConfig.requestType) {
      params.append('requestType', reportConfig.requestType);
    }
    if (startDate !== undefined && startDate !== null) params.append('startDate', startDate);
    if (endDate !== undefined && endDate !== null) params.append('endDate', endDate);
    if (limit !== undefined && limit !== null && limit > 0) params.append('limit', String(limit));

    const url = `${reportConfig.endpoint}?${params.toString()}`;
    const token = authClient.getToken();
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}: Failed to generate report`);
    }
    const result = await res.json();
    return result;
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch report from server',
    };
  }
}

export function exportReportToExcel(rows: Record<string, any>[], fileName: string, sheetName: string = 'ReportData'): void {
  if (!rows || rows.length === 0) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook: XLSX.WorkBook = {
    Sheets: { [sheetName.slice(0, 31)]: worksheet },
    SheetNames: [sheetName.slice(0, 31)],
  };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `${fileName}.xlsx`);
}

export function exportReportToCsv(rows: Record<string, any>[], fileName: string): void {
  if (!rows || rows.length === 0) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csvContent = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${fileName}.csv`);
}

function downloadBlob(blob: Blob, fullFileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fullFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
