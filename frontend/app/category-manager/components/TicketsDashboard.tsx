'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Filter,
  Download,
  Plus,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  ExternalLink,
  Flame,
  User,
  Building2,
  Calendar,
  MessageSquare,
  ChevronRight,
  Send,
  Ticket as TicketIcon,
} from 'lucide-react';
import {
  fetchTicketSummary,
  fetchTickets,
  fetchTicketById,
  createTicket,
  updateTicket,
  escalateTicket,
  addTicketComment,
  getExportTicketsUrl,
} from '@/lib/ticketClient';
import type { Ticket, TicketSummary, TicketPriority, TicketStatus } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

const TICKET_CATEGORIES = [
  'General',
  'Technical',
  'Billing',
  'Quality',
  'Quality Issue',
  'Commercial',
  'Compliance',
  'Quality & Compliance',
  'Delivery & Logistics',
  'Logistics & Dispatch',
  'Billing & Commercial',
  'Account',
  'Vendor Performance',
];

const TICKET_PRIORITIES: TicketPriority[] = ['Critical', 'High', 'Medium', 'Low'];
const TICKET_STATUSES: TicketStatus[] = ['Pending', 'In Progress', 'Escalated', 'Completed'];

export default function TicketsDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [summary, setSummary] = useState<TicketSummary>({
    total: 0,
    pending: 0,
    inProgress: 0,
    escalated: 0,
    completed: 0,
    criticalCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  // Modals & Details
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isEscalateOpen, setIsEscalateOpen] = useState<boolean>(false);
  const [escalatingTicket, setEscalatingTicket] = useState<Ticket | null>(null);

  // Create Form State
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<TicketPriority>('Medium');
  const [newCategory, setNewCategory] = useState('General');
  const [newProject, setNewProject] = useState('Enterprise Procurement Hub');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newAssignedToName, setNewAssignedToName] = useState('Navin Chaudhary');
  const [newSlaHours, setNewSlaHours] = useState(24);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Escalate Form State
  const [escalateTo, setEscalateTo] = useState('Sudheer Kangala (Operations Lead)');
  const [escalateReason, setEscalateReason] = useState('');

  // Comment State
  const [newComment, setNewComment] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const loadSummary = useCallback(async () => {
    const s = await fetchTicketSummary();
    setSummary(s);
  }, []);

  const loadTickets = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchTickets({
        search,
        status: statusFilter,
        priority: priorityFilter,
        category: categoryFilter,
        project: projectFilter,
        dateFrom,
        dateTo,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setTickets(res.data);
      setTotal(res.total);
    } catch {
      setErrorMessage('Failed to load tickets.');
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, priorityFilter, categoryFilter, projectFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    void loadSummary();
    void loadTickets();
  }, [loadSummary, loadTickets]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim()) {
      showToast('Please provide a ticket subject.');
      return;
    }

    setIsSubmitting(true);
    const res = await createTicket({
      subject: newSubject.trim(),
      description: newDescription.trim(),
      priority: newPriority,
      category: newCategory,
      project: newProject.trim(),
      customer_name: newCustomerName.trim() || 'Enterprise Client',
      customer_email: newCustomerEmail.trim() || 'client@procucev.com',
      customer_phone: newCustomerPhone.trim() || '+919876543210',
      assigned_to_name: newAssignedToName.trim(),
      sla_hours: Number(newSlaHours) || 24,
    });
    setIsSubmitting(false);

    if (res.success) {
      showToast('Ticket created successfully.');
      setIsCreateOpen(false);
      setNewSubject('');
      setNewDescription('');
      void loadSummary();
      void loadTickets();
    } else {
      showToast(res.error || 'Failed to create ticket.');
    }
  };

  const handleEscalateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escalatingTicket) return;
    if (!escalateReason.trim()) {
      showToast('Please state a reason for escalation.');
      return;
    }

    setIsSubmitting(true);
    const res = await escalateTicket(escalatingTicket.id, {
      escalatedTo: escalateTo,
      reason: escalateReason.trim(),
    });
    setIsSubmitting(false);

    if (res.success) {
      showToast('Ticket escalated successfully.');
      setIsEscalateOpen(false);
      setEscalatingTicket(null);
      setEscalateReason('');
      void loadSummary();
      void loadTickets();
      if (selectedTicket && selectedTicket.id === escalatingTicket.id) {
        void handleOpenDetails(escalatingTicket.id);
      }
    } else {
      showToast(res.error || 'Failed to escalate ticket.');
    }
  };

  const handleStatusChange = async (ticket: Ticket, newStatus: TicketStatus) => {
    const res = await updateTicket(ticket.id, { status: newStatus });
    if (res.success) {
      showToast(`Status updated to ${newStatus}.`);
      void loadSummary();
      void loadTickets();
      if (selectedTicket && selectedTicket.id === ticket.id) {
        void handleOpenDetails(ticket.id);
      }
    } else {
      showToast(res.error || 'Failed to update status.');
    }
  };

  const handleOpenDetails = async (id: string) => {
    const full = await fetchTicketById(id);
    if (full) {
      setSelectedTicket(full);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newComment.trim()) return;

    const res = await addTicketComment(selectedTicket.id, { comment: newComment.trim() });
    if (res.success) {
      setNewComment('');
      showToast('Note added.');
      void handleOpenDetails(selectedTicket.id);
    } else {
      showToast(res.error || 'Failed to add note.');
    }
  };

  const getPriorityBadge = (p: TicketPriority) => {
    switch (p) {
      case 'Critical':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300';
      case 'High':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
      case 'Medium':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300';
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300';
    }
  };

  const getStatusBadge = (s: TicketStatus) => {
    switch (s) {
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300';
      case 'Escalated':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300';
      default:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
    }
  };

  const strings = UI_STRINGS.actionCenter.tickets;

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-xl border border-slate-700 animate-slide-up flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-sky-700 dark:text-sky-300 text-xs font-semibold">
            <span>{strings.total}</span>
            <TicketIcon size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-sky-900 dark:text-sky-100">{summary.total}</div>
        </div>

        <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 text-xs font-semibold">
            <span>{strings.pending}</span>
            <Clock size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900 dark:text-amber-100">{summary.pending}</div>
        </div>

        <div className="bg-orange-50/70 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/60 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-orange-700 dark:text-orange-300 text-xs font-semibold">
            <span>{strings.escalated}</span>
            <Flame size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-orange-900 dark:text-orange-100">{summary.escalated}</div>
        </div>

        <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <span>{strings.completed}</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-900 dark:text-emerald-100">{summary.completed}</div>
        </div>

        <div className="bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 rounded-xl p-3.5 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-rose-700 dark:text-rose-300 text-xs font-semibold">
            <span>{strings.critical}</span>
            <AlertCircle size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-rose-900 dark:text-rose-100">{summary.criticalCount}</div>
        </div>
      </div>

      {/* Error Message Banner */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-xs text-rose-800 dark:text-rose-200 animate-fade-in">
          <AlertTriangle size={15} className="text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Control Bar: Filters, Search, Export, Create */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={strings.searchPlaceholder}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              isFilterOpen
                ? 'bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-300'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter size={13} />
            <span>Filter</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={getExportTicketsUrl({ search, status: statusFilter, priority: priorityFilter, category: categoryFilter })}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50"
          >
            <Download size={13} />
            <span>Export</span>
          </a>

          <button
            type="button"
            onClick={() => {
              void loadSummary();
              void loadTickets();
            }}
            title="Refresh"
            className="p-1.5 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-all"
          >
            <Plus size={14} />
            <span>{strings.createTicket}</span>
          </button>
        </div>
      </div>

      {/* Filter Row Drawer (Expandable) */}
      {isFilterOpen && (
        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs animate-fade-in">
          <div>
            <label className="block text-slate-500 font-semibold mb-1">Status</label>
            <select
              aria-label="Filter by Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              <option value="all">All Statuses</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">Priority</label>
            <select
              aria-label="Filter by Priority"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              <option value="all">All Priorities</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">Category</label>
            <select
              aria-label="Filter by Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              <option value="all">All Categories</option>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">Project</label>
            <select
              aria-label="Filter by Project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              <option value="all">All Projects</option>
              <option value="Project Falcon">Project Falcon</option>
              <option value="Project Orion">Project Orion</option>
              <option value="Project Titan">Project Titan</option>
              <option value="Enterprise Procurement Hub">Enterprise Procurement Hub</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">From Date</label>
            <input
              type="date"
              aria-label="Filter From Date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">To Date</label>
            <input
              type="date"
              aria-label="Filter To Date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            />
          </div>

          <div className="col-span-2 sm:col-span-4 md:col-span-6 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setPriorityFilter('all');
                setCategoryFilter('all');
                setProjectFilter('all');
                setDateFrom('');
                setDateTo('');
                setSearch('');
              }}
              className="px-4 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100"
            >
              Reset Filters
            </button>
          </div>
        </div>
      )}

      {/* Ticket Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3.5">Status</th>
                <th className="py-3 px-3.5">Ticket ID & Subject</th>
                <th className="py-3 px-3.5">Project</th>
                <th className="py-3 px-3.5">Customer</th>
                <th className="py-3 px-3.5">Category</th>
                <th className="py-3 px-3.5">Priority</th>
                <th className="py-3 px-3.5">Assigned To</th>
                <th className="py-3 px-3.5">SLA / Due</th>
                <th className="py-3 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Loading tickets...</span>
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <TicketIcon className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">{strings.noTicketsFound}</p>
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(
                          ticket.status
                        )}`}
                      >
                        {ticket.status}
                      </span>
                    </td>

                    <td className="py-3 px-3.5 min-w-[220px]">
                      <div className="font-semibold text-slate-900 dark:text-white line-clamp-1">{ticket.subject}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 font-mono">
                        <span>{ticket.ticket_number}</span>
                        {ticket.escalation_level ? (
                          <span className="text-rose-500 font-bold">L{ticket.escalation_level} Escalated</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">
                      {ticket.project || 'General'}
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <div className="font-medium text-slate-900 dark:text-white">{ticket.customer_name || 'Client'}</div>
                      <div className="text-[10px] text-slate-400">{ticket.customer_email || ''}</div>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md">
                        {ticket.category || 'General'}
                      </span>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getPriorityBadge(
                          ticket.priority
                        )}`}
                      >
                        {ticket.priority}
                      </span>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                      {ticket.assigned_to_name || 'Unassigned'}
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap text-[11px] text-slate-500">
                      <div>{ticket.due_date ? new Date(ticket.due_date).toLocaleDateString() : '24h'}</div>
                      <div className="text-[10px] text-slate-400">{ticket.sla_hours || 24}h SLA</div>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenDetails(ticket.id)}
                          title="View Details"
                          className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <ExternalLink size={14} />
                        </button>

                        {ticket.status !== 'Completed' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEscalatingTicket(ticket);
                                setIsEscalateOpen(true);
                              }}
                              title="Escalate Ticket"
                              className="p-1.5 text-slate-500 hover:text-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-950/40"
                            >
                              <Flame size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStatusChange(ticket, 'Completed')}
                              title="Mark as Completed"
                              className="p-1.5 text-slate-500 hover:text-emerald-600 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            >
                              <CheckCircle2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE TICKET MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <TicketIcon className="text-indigo-600" size={18} />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">{strings.createTicket}</h3>
              </div>
              <button
                type="button"
                aria-label="Close create ticket modal"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Subject *</label>
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="e.g. Discrepancy in motor test certificates"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Priority</label>
                  <select
                    aria-label="Ticket Priority"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    aria-label="Ticket Category"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {TICKET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Project / Entity</label>
                <input
                  type="text"
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  placeholder="e.g. Tata Steel Mechanical Spares"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="e.g. Tata Steel Ltd"
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Customer Email</label>
                  <input
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    placeholder="buyer@tatasteel.com"
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Assigned Executive</label>
                  <input
                    type="text"
                    aria-label="Assigned Executive"
                    value={newAssignedToName}
                    onChange={(e) => setNewAssignedToName(e.target.value)}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">SLA (Hours)</label>
                  <input
                    type="number"
                    aria-label="SLA Hours"
                    value={newSlaHours}
                    onChange={(e) => setNewSlaHours(Number(e.target.value))}
                    min={1}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Detail the technical or commercial fault reported..."
                  className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
                >
                  {isSubmitting ? 'Creating...' : strings.saveTicket}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ESCALATE MODAL */}
      {isEscalateOpen && escalatingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Flame className="text-orange-500" size={18} />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">{strings.escalateTitle}</h3>
              </div>
              <button
                type="button"
                aria-label="Close escalation modal"
                onClick={() => setIsEscalateOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Escalating <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{escalatingTicket.ticket_number}</span> to a higher managerial level or specialist squad.
            </p>

            <form onSubmit={handleEscalateSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Escalate To</label>
                <input
                  type="text"
                  aria-label="Escalate Target"
                  value={escalateTo}
                  onChange={(e) => setEscalateTo(e.target.value)}
                  className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Reason for Escalation *</label>
                <textarea
                  rows={3}
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  placeholder="e.g. Critical SLA breach risk, supplier non-responsiveness..."
                  className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEscalateOpen(false)}
                  className="px-3.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg shadow-xs"
                >
                  {isSubmitting ? 'Escalating...' : 'Confirm Escalation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW DETAILS DRAWER */}
      {selectedTicket && (
        <div className="fixed inset-y-0 right-0 z-50 max-w-xl w-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col animate-slide-left">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <div>
              <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                {selectedTicket.ticket_number}
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm line-clamp-1">{selectedTicket.subject}</h3>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTicket(null)}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Quick Status Bar */}
            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Current Status</span>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold mt-1 border ${getStatusBadge(selectedTicket.status)}`}>
                  {selectedTicket.status}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {selectedTicket.status !== 'Completed' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange(selectedTicket, 'Completed')}
                    className="px-3 py-1 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs"
                  >
                    Resolve Ticket
                  </button>
                )}
                {selectedTicket.status !== 'Escalated' && selectedTicket.status !== 'Completed' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEscalatingTicket(selectedTicket);
                      setIsEscalateOpen(true);
                    }}
                    className="px-3 py-1 font-bold text-orange-700 bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:text-orange-300 rounded-lg border border-orange-300"
                  >
                    Escalate
                  </button>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <span className="text-slate-400 font-bold uppercase text-[10px]">Description</span>
              <p className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                {selectedTicket.description || 'No description provided.'}
              </p>
            </div>

            {/* Meta Grid */}
            <div className="grid grid-cols-2 gap-2.5 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Customer</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedTicket.customer_name || 'N/A'}</span>
                <span className="block text-[11px] text-slate-400">{selectedTicket.customer_email}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Assigned To</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedTicket.assigned_to_name || 'Unassigned'}</span>
                <span className="block text-[11px] text-slate-400">{selectedTicket.assigned_team || 'Operations'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Category & Priority</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedTicket.category}</span>
                <span className="block text-[11px] text-slate-400">Priority: {selectedTicket.priority}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">SLA & Due Date</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedTicket.sla_hours || 24} Hours</span>
                <span className="block text-[11px] text-slate-400">
                  {selectedTicket.due_date ? new Date(selectedTicket.due_date).toLocaleString() : 'N/A'}
                </span>
              </div>
            </div>

            {/* Activities & Comments Audit Trail */}
            <div className="space-y-2 pt-2">
              <span className="text-slate-400 font-bold uppercase text-[10px]">Activity & Audit History</span>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(selectedTicket.activities || []).map((act) => (
                  <div key={act.id} className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-slate-700 dark:text-slate-300">
                      <span>{act.actor_name || 'System'}</span>
                      <span className="text-[10px] text-slate-400">{new Date(act.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">{act.comment}</p>
                  </div>
                ))}
              </div>

              {/* Add Comment Form */}
              <form onSubmit={handleAddComment} className="pt-2 flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add an internal note or investigation update..."
                  className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                />
                <button
                  type="submit"
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1 font-bold"
                >
                  <Send size={13} />
                  <span>Post</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { TicketsDashboard };


