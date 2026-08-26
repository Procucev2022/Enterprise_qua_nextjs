'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  UserRole,
  SourcingMode,
  RFQItem,
  AIBotFeedItem,
  VendorOpportunity,
  AuditLogEntry,
  AzureServiceHealth,
  SystemConfig,
  QuoteComparison,
  VendorEvaluationRecord,
  VendorSubscriptionPlan,
} from './types';
import {
  SOURCING_MODES,
  INITIAL_RFQS,
  INITIAL_AI_FEED,
  INITIAL_VENDOR_OPPORTUNITIES,
  INITIAL_AUDIT_LOG,
  INITIAL_AZURE_HEALTH,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_VENDOR_EVALUATIONS,
} from './mock-data';

interface AppContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  isLoggedIn: boolean;
  setIsLoggedIn: (loggedIn: boolean) => void;
  currentMode: SourcingMode;
  setCurrentMode: (mode: SourcingMode) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  rfqs: RFQItem[];
  aiFeed: AIBotFeedItem[];
  vendorOpportunities: VendorOpportunity[];
  auditLogs: AuditLogEntry[];
  azureHealth: AzureServiceHealth[];
  systemConfig: SystemConfig;
  setSystemConfig: React.Dispatch<React.SetStateAction<SystemConfig>>;
  
  // Actions
  addNewRFQ: (rfq: Omit<RFQItem, 'id' | 'createdAt' | 'quotes' | 'quotesCount' | 'status' | 'chasingActive'>) => RFQItem;
  triggerWhatsAppChaser: (rfqNumber: string, vendorName?: string) => void;
  triggerChannelChaser: (rfqNumber: string, channel: 'call' | 'whatsapp' | 'sms' | 'email', vendorName?: string, customNote?: string) => void;
  triggerBatchChannelChaser: (rfqNumber: string, channels: ('call' | 'whatsapp' | 'sms')[]) => void;
  submitVendorBid: (rfqNumber: string, unitPrice: number, leadTimeDays: number, remarks: string) => void;
  approvePO: (rfqNumber: string, vendorName: string, amount: number) => void;
  addAuditLog: (action: string, rfqNumber?: string, user?: string) => void;
  addFeedItem: (title: string, message: string, type: AIBotFeedItem['type'], rfqNumber?: string, recipient?: string, channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system', channelDetails?: AIBotFeedItem['channelDetails']) => void;
  selectedRFQForMatrix: RFQItem | null;
  setSelectedRFQForMatrix: (rfq: RFQItem | null) => void;
  selectedRFQForDeepDive: RFQItem | null;
  setSelectedRFQForDeepDive: (rfq: RFQItem | null) => void;
  deepDiveModalOpen: boolean;
  setDeepDiveModalOpen: (open: boolean) => void;
  openRFQDeepDive: (rfq: RFQItem) => void;
  vendorEvaluations: VendorEvaluationRecord[];
  addVendorEvaluation: (record: VendorEvaluationRecord) => void;
  selectedVendorEvaluation: VendorEvaluationRecord | null;
  setSelectedVendorEvaluation: (evalRecord: VendorEvaluationRecord | null) => void;
  evaluationModalOpen: boolean;
  setEvaluationModalOpen: (open: boolean) => void;
  openVendorEvaluationSummary: (evalRecord: VendorEvaluationRecord) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Toast notifications
  toastMessage: { title: string; description: string; type: 'success' | 'info' | 'warning' } | null;
  showToast: (title: string, description: string, type?: 'success' | 'info' | 'warning') => void;
  dismissToast: () => void;

  // Sourcing Free Tier RFQ Limits (Max 5 for Version 1 Free Trial)
  remainingFreeRFQs: number;
  setRemainingFreeRFQs: React.Dispatch<React.SetStateAction<number>>;
  activeSubscription: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none';
  setActiveSubscription: React.Dispatch<React.SetStateAction<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none'>>;
  vendorSubscription: VendorSubscriptionPlan;
  setVendorSubscription: React.Dispatch<React.SetStateAction<VendorSubscriptionPlan>>;
  vendorRfqDownloadsUsed: number;
  setVendorRfqDownloadsUsed: React.Dispatch<React.SetStateAction<number>>;
  vendorCatalogue: any[];
  setVendorCatalogue: React.Dispatch<React.SetStateAction<any[]>>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Helper to generate realistic SHA-256 format strings
function generateShaHash(): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setCurrentRole] = useState<UserRole>('buyer');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentMode, setCurrentMode] = useState<SourcingMode>('mode_2');
  const [activeTab, setActiveTab] = useState<string>('command_center');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Subscription State
  const [remainingFreeRFQs, setRemainingFreeRFQs] = useState<number>(5);
  const [activeSubscription, setActiveSubscription] = useState<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none'>('free_trial');
  const [vendorSubscription, setVendorSubscription] = useState<VendorSubscriptionPlan>('premium');
  const [vendorRfqDownloadsUsed, setVendorRfqDownloadsUsed] = useState<number>(3);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        localStorage.setItem('procucev_theme', next);
      }
      return next;
    });
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('procucev_theme') as 'light' | 'dark' | null;
      if (saved && (saved === 'light' || saved === 'dark')) {
        setTheme(saved);
      } else {
        setTheme('light');
        localStorage.setItem('procucev_theme', 'light');
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'light') {
        root.classList.add('light');
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
        root.classList.remove('light');
      }
    }
  }, [theme]);
  
  const [rfqs, setRfqs] = useState<RFQItem[]>(INITIAL_RFQS);
  const [aiFeed, setAiFeed] = useState<AIBotFeedItem[]>(INITIAL_AI_FEED);
  const [vendorOpportunities, setVendorOpportunities] = useState<VendorOpportunity[]>(INITIAL_VENDOR_OPPORTUNITIES);
  const [vendorCatalogue, setVendorCatalogue] = useState<any[]>([
    { id: 'prod-1', name: 'Centrifugal Water Pump (Model: ANSI-500)', category: 'Pumps & Fluid Dynamics', sku: 'SKU-FLUID-P500', specs: '500 GPM flow rate, 15 HP heavy-duty motor, ANSI Class 150 flanged connection.', unitPrice: 10950, leadTimeDays: 10, moq: 2 },
    { id: 'prod-2', name: 'Flanged Gate Valve (4-inch, Class 150)', category: 'Valves & Flow Control', sku: 'SKU-VALVE-G150', specs: 'Cast steel body, wedge gate, flanged ends, API 600 standards compliant.', unitPrice: 850, leadTimeDays: 5, moq: 10 },
    { id: 'prod-3', name: 'High-Pressure Ball Valve (2-inch, Class 300)', category: 'Valves & Flow Control', sku: 'SKU-VALVE-B300', specs: 'Stainless steel SS316 body, floating ball, threaded ends, PTFE seals.', unitPrice: 420, leadTimeDays: 4, moq: 15 },
    { id: 'prod-4', name: 'Flexible Metal Expansion Joint (6-inch)', category: 'Pipes & Fittings', sku: 'SKU-PIPE-J006', specs: 'Stainless steel bellows, carbon steel flanges, absorbs thermal expansion and vibration.', unitPrice: 310, leadTimeDays: 7, moq: 5 },
    { id: 'prod-5', name: 'Industrial Flow Sensor (Digital, BACnet)', category: 'Sensors & Instrumentation', sku: 'SKU-SENS-F200', specs: 'Electromagnetic flow meter, digital LCD readout, BACnet MS/TP integration.', unitPrice: 1250, leadTimeDays: 3, moq: 1 },
  ]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOG);
  const [azureHealth, setAzureHealth] = useState<AzureServiceHealth[]>(INITIAL_AZURE_HEALTH);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(INITIAL_SYSTEM_CONFIG);
  const [selectedRFQForMatrix, setSelectedRFQForMatrix] = useState<RFQItem | null>(INITIAL_RFQS[0]);
  const [selectedRFQForDeepDive, setSelectedRFQForDeepDive] = useState<RFQItem | null>(INITIAL_RFQS[0]);
  const [deepDiveModalOpen, setDeepDiveModalOpen] = useState<boolean>(false);
  
  const [vendorEvaluations, setVendorEvaluations] = useState<VendorEvaluationRecord[]>(INITIAL_VENDOR_EVALUATIONS);
  const [selectedVendorEvaluation, setSelectedVendorEvaluation] = useState<VendorEvaluationRecord | null>(INITIAL_VENDOR_EVALUATIONS[0]);
  const [evaluationModalOpen, setEvaluationModalOpen] = useState<boolean>(false);

  const openRFQDeepDive = (rfq: RFQItem) => {
    setSelectedRFQForDeepDive(rfq);
    setDeepDiveModalOpen(true);
  };

  const openVendorEvaluationSummary = (evalRecord: VendorEvaluationRecord) => {
    setSelectedVendorEvaluation(evalRecord);
    setEvaluationModalOpen(true);
  };

  const addVendorEvaluation = (record: VendorEvaluationRecord) => {
    setVendorEvaluations((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
  };
  
  const [toastMessage, setToastMessage] = useState<{ title: string; description: string; type: 'success' | 'info' | 'warning' } | null>(null);

  const showToast = (title: string, description: string, type: 'success' | 'info' | 'warning' = 'info') => {
    setToastMessage({ title, description, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.title === title ? null : prev));
    }, 4500);
  };

  const dismissToast = () => {
    setToastMessage(null);
  };

  const addAuditLog = (action: string, rfqNumber?: string, user?: string) => {
    const defaultUser =
      currentRole === 'buyer'
        ? 'client@procucev.com (Enterprise Buyer)'
        : currentRole === 'category_manager'
        ? 'catmanager@procucev.com (Category Manager)'
        : currentRole === 'vendor'
        ? 'vendor@apex.com (Apex Supplies Ltd.)'
        : 'admin@procucev.com (System Admin)';

    const newLog: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      user: user || defaultUser,
      action,
      rfqNumber,
      shaSignature: generateShaHash(),
      status: 'VERIFIED',
      ipAddress: '104.42.189.44',
    };
    setAuditLogs((prev) => [newLog, ...prev]);
  };

  const addFeedItem = (
    title: string,
    message: string,
    type: AIBotFeedItem['type'],
    rfqNumber?: string,
    recipient?: string,
    channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system',
    channelDetails?: AIBotFeedItem['channelDetails']
  ) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newFeed: AIBotFeedItem = {
      id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: timeStr,
      timeAgo: 'Just now',
      type,
      channel: channel || (type === 'call' || type === 'whatsapp' || type === 'sms' || type === 'email' ? type : undefined),
      title,
      message,
      recipient,
      rfqNumber,
      status: 'completed',
      channelDetails,
    };
    setAiFeed((prev) => [newFeed, ...prev]);
  };

  const triggerChannelChaser = (
    rfqNumber: string,
    channel: 'call' | 'whatsapp' | 'sms' | 'email',
    vendorName = 'Apex Supplies Ltd.',
    customNote?: string
  ) => {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Channel-specific title & message
    let title = '';
    let message = '';
    let toastTitle = '';
    let toastDesc = '';

    if (channel === 'call') {
      title = `AI Voice Bot Call Dispatched`;
      message = `Autonomous AI Voice Agent placed telephonic outreach to ${vendorName} for ${rfqNumber}. Line connected; confirmed quote turnaround SLA.`;
      toastTitle = `AI Voice Call Initiated!`;
      toastDesc = `Outbound phone call connected to ${vendorName} for ${rfqNumber}.`;
    } else if (channel === 'whatsapp') {
      title = `WhatsApp Interactive Chaser Dispatched`;
      message = `Automated WhatsApp quotation prompt with 1-click bid link delivered to ${vendorName} for ${rfqNumber}.`;
      toastTitle = `WhatsApp Chaser Sent!`;
      toastTitle = `WhatsApp Chaser Read!`;
      toastDesc = `Vendor accessed the interactive 1-click bid link.`;
    } else if (channel === 'sms') {
      toastTitle = `SMS Alert Dispatched!`;
      toastDesc = `Priority SMS notice delivered to ${vendorName}.`;
    } else {
      toastTitle = `24h Email Reminder Sent!`;
      toastDesc = `Escalation notice with BOQ specs delivered to ${vendorName}.`;
    }

    if (customNote) {
      message += ` (Note: "${customNote}")`;
    }

    addFeedItem(title, message, channel, rfqNumber, vendorName, channel, {
      duration: channel === 'call' ? '1m 30s' : undefined,
      transcriptSummary: channel === 'call' ? `Vendor confirmed RFQ receipt and will submit bid before deadline.` : undefined,
      actionOutcome: channel === 'whatsapp' ? 'Link delivered' : channel === 'sms' ? 'Carrier delivered' : channel === 'email' ? 'BOQ Specs re-attached · Immediate bid requested' : 'Voice connected',
    });

    addAuditLog(
      `Triggered ${channel.toUpperCase()} automated follow-up for ${rfqNumber} to ${vendorName}`,
      rfqNumber
    );

    // Dynamically update RFQ follow-up record
    setRfqs((prev) =>
      prev.map((r) => {
        if (r.rfqNumber === rfqNumber && r.followUpData) {
          const updatedVendors = r.followUpData.vendors.map((v) => {
            if (v.vendorName.toLowerCase().includes(vendorName.toLowerCase()) || vendorName.toLowerCase().includes(v.vendorName.toLowerCase())) {
              return {
                ...v,
                attemptsCount: v.attemptsCount + 1,
                lastInteraction: timeNow,
                overallStatus: 'Follow-up Active' as const,
                call: channel === 'call' ? {
                  ...v.call,
                  status: 'completed' as const,
                  lastAttempt: timeNow,
                  duration: '1m 30s',
                  summary: 'AI Voice Call connected with sales coordinator. Acknowledged RFQ requirements.',
                } : v.call,
                whatsapp: channel === 'whatsapp' ? {
                  ...v.whatsapp,
                  status: 'read' as const,
                  lastAttempt: timeNow,
                  messagePreview: 'Urgent RFQ follow-up link delivered.',
                  linkClicked: true,
                } : v.whatsapp,
                sms: channel === 'sms' ? {
                  ...v.sms,
                  status: 'delivered' as const,
                  lastAttempt: timeNow,
                } : v.sms,
                email24h: channel === 'email' ? {
                  status: 'reminded_24h' as const,
                  lastAttempt: timeNow,
                  is24hReminderSent: true,
                  subject: `URGENT REMINDER: Quotation Request for ${rfqNumber}`,
                } : v.email24h,
              };
            }
            return v;
          });

          const callTotal = channel === 'call' ? r.followUpData.callStats.total + 1 : r.followUpData.callStats.total;
          const callConnected = channel === 'call' ? r.followUpData.callStats.connected + 1 : r.followUpData.callStats.connected;
          const waTotal = channel === 'whatsapp' ? r.followUpData.whatsappStats.total + 1 : r.followUpData.whatsappStats.total;
          const waDelivered = channel === 'whatsapp' ? r.followUpData.whatsappStats.delivered + 1 : r.followUpData.whatsappStats.delivered;
          const waRead = channel === 'whatsapp' ? r.followUpData.whatsappStats.read + 1 : r.followUpData.whatsappStats.read;
          const smsTotal = channel === 'sms' ? r.followUpData.smsStats.total + 1 : r.followUpData.smsStats.total;
          const smsDelivered = channel === 'sms' ? r.followUpData.smsStats.delivered + 1 : r.followUpData.smsStats.delivered;
          const emailSent24h = channel === 'email' ? (r.followUpData.emailStats?.sent24h || 0) + 1 : (r.followUpData.emailStats?.sent24h || 0);

          const updatedRfq = {
            ...r,
            followUpData: {
              ...r.followUpData,
              callStats: { ...r.followUpData.callStats, total: callTotal, connected: callConnected },
              whatsappStats: { ...r.followUpData.whatsappStats, total: waTotal, delivered: waDelivered, read: waRead },
              smsStats: { ...r.followUpData.smsStats, total: smsTotal, delivered: smsDelivered },
              emailStats: { total: r.followUpData.emailStats?.total || 5, sent24h: emailSent24h, opened: (r.followUpData.emailStats?.opened || 1) },
              vendors: updatedVendors,
            },
          };

          // Also keep selectedRFQForDeepDive in sync
          setSelectedRFQForDeepDive((cur) => (cur && cur.rfqNumber === rfqNumber ? updatedRfq : cur));

          return updatedRfq;
        }
        return r;
      })
    );

    showToast(toastTitle, toastDesc, 'success');
  };

  const triggerBatchChannelChaser = (rfqNumber: string, channels: ('call' | 'whatsapp' | 'sms')[]) => {
    channels.forEach((ch) => {
      triggerChannelChaser(rfqNumber, ch, 'All Pending Suppliers');
    });
    showToast(
      'Multi-Channel Batch Broadcast Active!',
      `AI chasing dispatched across ${channels.map((c) => c.toUpperCase()).join(' + ')} for ${rfqNumber}.`,
      'success'
    );
  };

  const triggerWhatsAppChaser = (rfqNumber: string, vendorName = 'Apex Supplies Ltd.') => {
    triggerChannelChaser(rfqNumber, 'whatsapp', vendorName);
  };

  const submitVendorBid = (
    rfqNumber: string,
    unitPrice: number,
    leadTimeDays: number,
    remarks: string
  ) => {
    const newQuote: QuoteComparison = {
      vendorId: `v-${Date.now()}`,
      vendorName: 'Apex Supplies Ltd. (Verified)',
      vendorCategory: 'Procucev - AI Rec',
      unitPrice,
      totalPrice: unitPrice * 12,
      leadTimeDays,
      aiMatchScore: 95,
      isBestPrice: true,
      isPreferred: true,
      warrantyYears: 3,
      complianceStatus: 'Fully Compliant',
      paymentTerms: 'Net 30 Days',
      remarks,
    };

    setRfqs((prev) =>
      prev.map((r) => {
        if (r.rfqNumber === rfqNumber) {
          const updatedQuotes = [...r.quotes.map(q => ({ ...q, isBestPrice: false, isPreferred: false })), newQuote];
          return {
            ...r,
            quotesCount: updatedQuotes.length,
            status: 'AI Recommended',
            quotes: updatedQuotes,
            aiScore: 95,
          };
        }
        return r;
      })
    );

    setVendorOpportunities((prev) =>
      prev.map((o) => (o.rfqNumber === rfqNumber ? { ...o, status: 'submitted' } : o))
    );

    addFeedItem(
      `Bid Submitted by Apex Supplies Ltd.`,
      `Apex Supplies submitted line-item quotation ($${unitPrice.toLocaleString()}/unit, ${leadTimeDays}d lead time). AI Score: 95%.`,
      'scoring',
      rfqNumber,
      'Apex Supplies Ltd.'
    );

    addAuditLog(
      `Apex Supplies Ltd. submitted verified quotation for ${rfqNumber} ($${unitPrice.toLocaleString()})`,
      rfqNumber,
      'vendor@apex.com'
    );

    showToast(
      'Quotation Submitted Successfully!',
      `Your bid for ${rfqNumber} has been validated and injected into the Buyer Comparative Matrix.`,
      'success'
    );
  };

  const approvePO = (rfqNumber: string, vendorName: string, amount: number) => {
    setRfqs((prev) =>
      prev.map((r) => (r.rfqNumber === rfqNumber ? { ...r, status: 'PO Generated' } : r))
    );

    addFeedItem(
      `Purchase Order Generated: ${rfqNumber}`,
      `Approved PO generated for ${vendorName} totaling $${amount.toLocaleString()}. Dispatched to ERP & Vendor Portal.`,
      'approval',
      rfqNumber
    );

    addAuditLog(
      `Approved PO Generation & Dispatched Contract for ${rfqNumber} to ${vendorName} ($${amount.toLocaleString()})`,
      rfqNumber
    );

    showToast(
      'Purchase Order Issued!',
      `Official PO contract generated and signed with SHA-256 digital stamp for ${vendorName}.`,
      'success'
    );
  };

  const addNewRFQ = (
    rfqData: Omit<RFQItem, 'id' | 'createdAt' | 'quotes' | 'quotesCount' | 'status' | 'chasingActive'>
  ) => {
    // Subscription Limits Validation
    if (activeSubscription === 'none') {
      showToast('Subscription Upgrade Required', 'Your organization domain has already claimed its free trial. You must subscribe to a sourcing mode to dispatch RFQs.', 'warning');
      throw new Error('Subscription required');
    }

    if (activeSubscription === 'free_trial') {
      if (rfqData.sourcingMode !== 'mode_1') {
        showToast('Subscription Upgrade Required', 'Your Free Trial is restricted strictly to Version 1 (Mode 1) sourcing. Please upgrade to a paid subscription to access other modes.', 'warning');
        throw new Error('Subscription required');
      }
      if (remainingFreeRFQs <= 0) {
        showToast('Free Trial Expired', 'You have used all 5 free Version 1 RFQs. Please subscribe to a paid plan to continue.', 'warning');
        throw new Error('Free trial limits reached');
      }
      setRemainingFreeRFQs(prev => prev - 1);
    } else {
      // Paid subscription check
      if (rfqData.sourcingMode === 'mode_2' && activeSubscription === 'version_1') {
        showToast('Upgrade Required', 'Version 2 (Mode 2) Sourcing requires a Version 2 (Hybrid Network) Plan subscription.', 'warning');
        throw new Error('Subscription required');
      }
      if (rfqData.sourcingMode === 'mode_3' && activeSubscription !== 'version_3') {
        showToast('Upgrade Required', 'Version 3 (Mode 3) Sourcing requires a Version 3 (Autonomous AI) Plan subscription.', 'warning');
        throw new Error('Subscription required');
      }
    }
    // Dynamic Working Hours calculations: Monday to Saturday (8 AM to 7 PM IST, Sunday off)
    const addWorkingHours = (startDate: Date, hoursToAdd: number): Date => {
      const START_HOUR = 8; // 8 AM
      const END_HOUR = 19; // 7 PM
      let currentDate = new Date(startDate.getTime());

      // If Sunday, skip to Monday 8 AM
      if (currentDate.getDay() === 0) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(START_HOUR, 0, 0, 0);
      }

      // If start date is outside working hours, adjust to the next valid start
      let curHour = currentDate.getHours();
      if (curHour >= END_HOUR) {
        currentDate.setDate(currentDate.getDate() + 1);
        // If next day is Sunday, skip to Monday
        if (currentDate.getDay() === 0) {
          currentDate.setDate(currentDate.getDate() + 1);
        }
        currentDate.setHours(START_HOUR, 0, 0, 0);
      } else if (curHour < START_HOUR) {
        currentDate.setHours(START_HOUR, 0, 0, 0);
      }

      let remainingHours = hoursToAdd;
      while (remainingHours > 0) {
        // Skip Sunday checks inside the addition loop
        if (currentDate.getDay() === 0) {
          currentDate.setDate(currentDate.getDate() + 1);
          currentDate.setHours(START_HOUR, 0, 0, 0);
        }

        const currentHour = currentDate.getHours();
        const currentMinutes = currentDate.getMinutes();
        const remainingWorkHoursInDay = (END_HOUR - currentHour) - (currentMinutes / 60);

        if (remainingHours <= remainingWorkHoursInDay) {
          const newTime = currentDate.getTime() + remainingHours * 60 * 60 * 1000;
          currentDate = new Date(newTime);
          remainingHours = 0;
        } else {
          remainingHours -= remainingWorkHoursInDay;
          currentDate.setDate(currentDate.getDate() + 1);
          // If next day is Sunday, skip to Monday 8 AM
          if (currentDate.getDay() === 0) {
            currentDate.setDate(currentDate.getDate() + 1);
          }
          currentDate.setHours(START_HOUR, 0, 0, 0);
        }
      }
      return currentDate;
    };

    const formatDateIST = (date: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[date.getMonth()];
      const day = date.getDate();
      let hours = date.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const minutes = pad(date.getMinutes());
      return `${day}-${month} ${hours}:${minutes} ${ampm} IST`;
    };

    const createdAtTime = new Date();
    const createdAtStr = createdAtTime.toISOString().replace('T', ' ').substring(0, 19);

    const emailSentTime = createdAtTime;
    const smsScheduledTime = new Date(createdAtTime.getTime() + 5 * 60 * 1000); // 5 mins after Email
    const callScheduledTime = addWorkingHours(smsScheduledTime, 6); // 6 working hours after SMS
    const whatsappScheduledTime = addWorkingHours(smsScheduledTime, 12); // 12 working hours after SMS

    const emailSentStr = formatDateIST(emailSentTime);
    const smsScheduledStr = formatDateIST(smsScheduledTime);
    const callScheduledStr = formatDateIST(callScheduledTime);
    const whatsappScheduledStr = formatDateIST(whatsappScheduledTime);

    const id = `rfq-${Date.now().toString().slice(-5)}`;
    const newRFQ: RFQItem = {
      ...rfqData,
      id,
      createdAt: createdAtStr,
      quotesCount: 0,
      status: 'Quotes Pending',
      chasingActive: true,
      chaserMethod: 'Multi-Channel',
      quotes: [],
      followUpData: {
        rfqNumber: rfqData.rfqNumber,
        totalInvited: 4,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: '0m 00s' },
        whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: 0, delivered: 0, clicked: 0 },
        nextScheduledChaser: `Email: Sent (${emailSentStr}) • SMS: Scheduled 5m later at ${smsScheduledStr}`,
        autoChasingEnabled: true,
        vendors: [
          {
            vendorId: `v-auto-1`,
            vendorName: 'Apex Supplies Ltd.',
            phone: '+91 98201 44820',
            contactPerson: 'Rajesh Nair',
            call: { status: 'scheduled', lastAttempt: `Scheduled: ${callScheduledStr} (+6 Working Hours from SMS)` },
            whatsapp: { status: 'pending', lastAttempt: `Scheduled: ${whatsappScheduledStr} (+12 Working Hours from SMS)` },
            sms: { status: 'pending', lastAttempt: `Scheduled: ${smsScheduledStr} (5m post-dispatch)` },
            overallStatus: 'Pending',
            lastInteraction: 'Just created',
            attemptsCount: 0,
            bidStatus: 'Pending',
          },
          {
            vendorId: `v-auto-2`,
            vendorName: 'Global Industrial Solutions',
            phone: '+91 98400 11223',
            contactPerson: 'Sunil Rao',
            call: { status: 'scheduled', lastAttempt: `Scheduled: ${callScheduledStr} (+6 Working Hours from SMS)` },
            whatsapp: { status: 'pending', lastAttempt: `Scheduled: ${whatsappScheduledStr} (+12 Working Hours from SMS)` },
            sms: { status: 'pending', lastAttempt: `Scheduled: ${smsScheduledStr} (5m post-dispatch)` },
            overallStatus: 'Pending',
            lastInteraction: 'Just created',
            attemptsCount: 0,
            bidStatus: 'Pending',
          },
        ],
      },
    };

    setRfqs((prev) => [newRFQ, ...prev]);
    
    // Also create a vendor opportunity in the portal
    const newOpp: VendorOpportunity = {
      id: `opp-${Date.now()}`,
      rfqNumber: newRFQ.rfqNumber,
      title: newRFQ.title,
      buyer: 'Procucev Global Client',
      deadline: newRFQ.targetDeliveryDate,
      daysRemaining: 7,
      type: newRFQ.sourcingMode === 'mode_1' ? 'direct_invitation' : 'network_marketplace',
      estimatedValue: newRFQ.budget > 0 ? `$${(newRFQ.budget / 1000).toFixed(0)}k` : undefined,
      deliveryLocation: 'Enterprise Logistics Hub (Navi Mumbai)',
      status: 'pending_bid',
      lineItems: newRFQ.extractedEntities.map((e, idx) => ({
        id: `li-new-${idx}`,
        description: `${e.itemName} (${e.technicalSpecs})`,
        quantity: e.quantity,
        unitPrice: 0,
        leadTimeDays: 14,
        marketBandStatus: 'optimal',
        paymentTerms: 'Net 30 Days',
      })),
    };
    setVendorOpportunities((prev) => [newOpp, ...prev]);

    addFeedItem(
      `RFQ Dispatched: ${newRFQ.rfqNumber}`,
      `Dispatched to target vendor roster under ${SOURCING_MODES.find(m => m.id === newRFQ.sourcingMode)?.shortLabel}. Multi-channel automated chasing active across Call, WhatsApp & SMS.`,
      'whatsapp',
      newRFQ.rfqNumber,
      'Target Vendor Pool'
    );

    addAuditLog(
      `Created and dispatched ${newRFQ.rfqNumber} (${SOURCING_MODES.find(m => m.id === newRFQ.sourcingMode)?.name})`,
      newRFQ.rfqNumber
    );

    showToast(
      'RFQ Successfully Dispatched!',
      `${newRFQ.rfqNumber} is now live with automated AI Call, WhatsApp & SMS chasing enabled.`,
      'success'
    );

    if (rfqData.sourcingMode === 'mode_1') {
      // Step 0: Immediate Email Dispatched
      addFeedItem(
        'RFQ Specification Dispatched via Email',
        `AI Sourcing System sent the formal RFQ package including technical BOQ items via Email to Rajesh Nair (rajesh@apexsupplies.in) at ${emailSentStr}.`,
        'system',
        newRFQ.rfqNumber,
        'Apex Supplies Ltd.'
      );

      // Version 1 sequence: SMS (Immediate) -> Call (+6 working hours) -> WhatsApp (+12 working hours) -> Email Ingestion (Stop Chasing)
      setTimeout(() => {
        // Step 1: SMS Sent
        triggerChannelChaser(newRFQ.rfqNumber, 'sms', 'Apex Supplies Ltd.', `Asking for quote. (Production Target: ${smsScheduledStr})`);
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber && r.followUpData) {
              return {
                ...r,
                followUpData: {
                  ...r.followUpData,
                  nextScheduledChaser: `SMS: Sent (${smsScheduledStr}) • Call: Scheduled at ${callScheduledStr} (+6 Working Hrs)`,
                  vendors: r.followUpData.vendors.map((v) =>
                    v.vendorName === 'Apex Supplies Ltd.'
                      ? { ...v, sms: { status: 'delivered', lastAttempt: 'Sent: ' + smsScheduledStr } }
                      : v
                  ),
                },
              };
            }
            return r;
          })
        );
      }, 4000);

      setTimeout(() => {
        // Step 2: Follow up call
        triggerChannelChaser(newRFQ.rfqNumber, 'call', 'Apex Supplies Ltd.', `AI agent quote follow-up call. (Production Target: ${callScheduledStr})`);
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber && r.followUpData) {
              return {
                ...r,
                followUpData: {
                  ...r.followUpData,
                  nextScheduledChaser: `Call: Placed (${callScheduledStr}) • WA: Scheduled at ${whatsappScheduledStr} (+12 Working Hrs)`,
                  vendors: r.followUpData.vendors.map((v) =>
                    v.vendorName === 'Apex Supplies Ltd.'
                      ? { ...v, call: { status: 'completed', lastAttempt: 'Placed: ' + callScheduledStr, duration: '1m 30s', summary: 'AI Voice Call connected with sales coordinator.' } }
                      : v
                  ),
                },
              };
            }
            return r;
          })
        );
      }, 9500);

      setTimeout(() => {
        // Step 3: WhatsApp chaser
        triggerChannelChaser(newRFQ.rfqNumber, 'whatsapp', 'Apex Supplies Ltd.', `Official procurement channel dispatch. (Production Target: ${whatsappScheduledStr})`);
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber && r.followUpData) {
              return {
                ...r,
                followUpData: {
                  ...r.followUpData,
                  nextScheduledChaser: `WA: Sent (${whatsappScheduledStr}) • Awaiting Email Response`,
                  vendors: r.followUpData.vendors.map((v) =>
                    v.vendorName === 'Apex Supplies Ltd.'
                      ? { ...v, whatsapp: { status: 'read', lastAttempt: 'Delivered: ' + whatsappScheduledStr, messagePreview: 'RFQ bid link delivered.', linkClicked: true } }
                      : v
                  ),
                },
              };
            }
            return r;
          })
        );
      }, 15000);

      setTimeout(() => {
        // Step 4: Email Ingestion & Stop Follow-up
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Add email ingestion feed item
        addFeedItem(
          'Email Ingestion Gateway: Quote Received',
          `AI parser scanned quote attachment (Centrifugal_Pump_Quote_Apex.pdf) from Rajesh Nair (rajesh@apexsupplies.in). Successfully parsed pricing & lead times. Completed at ${timeNow}.`,
          'system',
          newRFQ.rfqNumber,
          'Apex Supplies Ltd.'
        );

        // Add audit log
        addAuditLog(
          `AI Ingested email quotation from Apex Supplies Ltd. for ${newRFQ.rfqNumber}. Automated follow-up halted.`,
          newRFQ.rfqNumber,
          'ai-gateway@procucev.com'
        );

        // Inject the quote into the RFQ and stop follow-ups
        setRfqs((prev) =>
          prev.map((r) => {
            if (r.rfqNumber === newRFQ.rfqNumber) {
              const newQuote: QuoteComparison = {
                vendorId: 'v-auto-1',
                vendorName: 'Apex Supplies Ltd.',
                vendorCategory: 'Procucev - AI Rec',
                unitPrice: 5200,
                totalPrice: 5200 * 12,
                leadTimeDays: 12,
                aiMatchScore: 94,
                isBestPrice: true,
                isPreferred: true,
                warrantyYears: 2,
                complianceStatus: 'Fully Compliant',
                paymentTerms: 'Net 60 Days (Email Response)',
                remarks: 'Ingested via email attachment Centrifugal_Pump_Quote.pdf. Fixed price for 12 months.'
              };

              const updatedVendors = r.followUpData ? r.followUpData.vendors.map((v) => {
                if (v.vendorName === 'Apex Supplies Ltd.') {
                  return {
                    ...v,
                    bidStatus: 'Submitted' as const,
                    overallStatus: 'Responded' as const,
                    lastInteraction: timeNow,
                  };
                }
                return v;
              }) : [];

              return {
                ...r,
                status: 'In Evaluation' as const,
                quotesCount: r.quotesCount + 1,
                chasingActive: false,
                quotes: [...r.quotes, newQuote],
                followUpData: r.followUpData ? {
                  ...r.followUpData,
                  respondedCount: r.followUpData.respondedCount + 1,
                  nextScheduledChaser: 'Halted (Quote Received)',
                  vendors: updatedVendors,
                } : undefined,
              };
            }
            return r;
          })
        );

        // Update selected deep-dive modal
        setSelectedRFQForDeepDive((cur) => {
          if (cur && cur.rfqNumber === newRFQ.rfqNumber) {
            const newQuote: QuoteComparison = {
              vendorId: 'v-auto-1',
              vendorName: 'Apex Supplies Ltd.',
              vendorCategory: 'Procucev - AI Rec',
              unitPrice: 5200,
              totalPrice: 5200 * 12,
              leadTimeDays: 12,
              aiMatchScore: 94,
              isBestPrice: true,
              isPreferred: true,
              warrantyYears: 2,
              complianceStatus: 'Fully Compliant',
              paymentTerms: 'Net 60 Days (Email Response)',
              remarks: 'Ingested via email attachment Centrifugal_Pump_Quote.pdf. Fixed price for 12 months.'
            };
            return {
              ...cur,
              status: 'In Evaluation',
              quotesCount: cur.quotesCount + 1,
              chasingActive: false,
              quotes: [...cur.quotes, newQuote],
            };
          }
          return cur;
        });

        showToast(
          'Email Quote Ingested!',
          'Apex Supplies Ltd. quote updated. AI Chasing follow-up halted.',
          'success'
        );
      }, 19000);
    }

    if (rfqData.sourcingMode === 'mode_3') {
      // Step 0: Immediate Roster Email Dispatched
      addFeedItem(
        'RFQ Dispatched to Private Roster',
        `AI Sourcing System dispatched RFQ package via Email to Approved Private Roster (Apex Supplies, Global Industrial) at ${emailSentStr}.`,
        'system',
        newRFQ.rfqNumber,
        'Private Roster Pool'
      );

      // Step 1: Trigger Anonymous Double-Blind Evaluations for 10 Recommended Procucev Vendors
      addFeedItem(
        'Procucev Database Match: 10 Recommended Vendors Found',
        `AI matching engine scanned the Procucev vendor pool and recommended 10 verified suppliers (Delta Valve Systems, Dynamic Flow Controls, ElectroMech Pumps, etc.) matching the '${newRFQ.extractedEntities[0]?.category || 'Mechanical'}' category.`,
        'system',
        newRFQ.rfqNumber,
        'AI Sourcing Desk'
      );

      addFeedItem(
        'Double-Blind Sourcing Initiated: 10 Evaluation Invites Dispatched',
        `Anonymous email and SMS messages dispatched with evaluation survey link and BOQ specifications to the 10 recommended database partners. Buyer identity (company name, contact details) is withheld until qualified.`,
        'system',
        newRFQ.rfqNumber,
        'Procucev Partner Pool'
      );

      addAuditLog(
        `Dispatched anonymous double-blind vendor qualification requests to 10 recommended database partners for ${newRFQ.rfqNumber}. Buyer identity withheld.`,
        newRFQ.rfqNumber,
        'ai-sourcing@procucev.com'
      );
    }

    return newRFQ;
  };

  // Sync role tab defaults
  useEffect(() => {
    if (currentRole === 'buyer') {
      setActiveTab('command_center');
    } else if (currentRole === 'category_manager') {
      setActiveTab('kanban_board');
    } else if (currentRole === 'vendor') {
      setActiveTab('vendor_feed');
    } else if (currentRole === 'admin') {
      setActiveTab('infra_control');
    }
  }, [currentRole]);

  return (
    <AppContext.Provider
      value={{
        currentRole,
        setCurrentRole,
        isLoggedIn,
        setIsLoggedIn,
        currentMode,
        setCurrentMode,
        activeTab,
        setActiveTab,
        rfqs,
        aiFeed,
        vendorOpportunities,
        auditLogs,
        azureHealth,
        systemConfig,
        setSystemConfig,
        addNewRFQ,
        triggerWhatsAppChaser,
        triggerChannelChaser,
        triggerBatchChannelChaser,
        submitVendorBid,
        approvePO,
        addAuditLog,
        addFeedItem,
        selectedRFQForMatrix,
        setSelectedRFQForMatrix,
        selectedRFQForDeepDive,
        setSelectedRFQForDeepDive,
        deepDiveModalOpen,
        setDeepDiveModalOpen,
        openRFQDeepDive,
        vendorEvaluations,
        addVendorEvaluation,
        selectedVendorEvaluation,
        setSelectedVendorEvaluation,
        evaluationModalOpen,
        setEvaluationModalOpen,
        openVendorEvaluationSummary,
        theme,
        setTheme,
        toggleTheme,
        toastMessage,
        showToast,
        dismissToast,
        remainingFreeRFQs,
        setRemainingFreeRFQs,
        activeSubscription,
        setActiveSubscription,
        vendorSubscription,
        setVendorSubscription,
        vendorRfqDownloadsUsed,
        setVendorRfqDownloadsUsed,
        vendorCatalogue,
        setVendorCatalogue,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
