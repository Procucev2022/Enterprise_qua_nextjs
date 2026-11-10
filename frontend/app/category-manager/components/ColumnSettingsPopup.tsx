'use client';

/**
 * ColumnSettingsPopup – Shared reusable column-settings modal for all
 * Action Center dashboards (LoginLogs, Tickets, Tasks, DocumentVault, etc.)
 *
 * Features:
 *  – Full column list with show/hide checkboxes
 *  – Drag-and-drop reordering with position numbers
 *  – Reset to Default button
 *  – Save / Done button with auto-save
 *  – Escape key / overlay click to close
 *  – Locked "required" columns rendered with padlock indicator
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { X, GripVertical, RotateCcw, Lock } from 'lucide-react';

export interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
  /** Locked columns cannot be hidden */
  required?: boolean;
}

interface ColumnSettingsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnDef[];
  onSave: (cols: ColumnDef[]) => void;
  onReset: () => void;
  title?: string;
}

export default function ColumnSettingsPopup({
  isOpen,
  onClose,
  columns,
  onSave,
  onReset,
  title = 'Column Settings',
}: ColumnSettingsPopupProps) {
  // Local draft copy so changes are only applied on "Done"
  const [draft, setDraft] = React.useState<ColumnDef[]>([]);
  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  // Sync draft whenever popup opens
  useEffect(() => {
    if (isOpen) {
      setDraft(columns.map((c) => ({ ...c })));
    }
  }, [isOpen, columns]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleToggle = useCallback((key: string) => {
    setDraft((prev) =>
      prev.map((col) =>
        col.key === key && !col.required ? { ...col, visible: !col.visible } : col,
      ),
    );
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverIdx.current = idx;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      e.preventDefault();
      if (draggedIdx === null || draggedIdx === targetIdx) {
        setDraggedIdx(null);
        return;
      }
      setDraft((prev) => {
        const next = [...prev];
        const [moved] = next.splice(draggedIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
      setDraggedIdx(null);
      dragOverIdx.current = null;
    },
    [draggedIdx],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIdx(null);
    dragOverIdx.current = null;
  }, []);

  const handleSave = useCallback(() => {
    onSave(draft);
    onClose();
  }, [draft, onSave, onClose]);

  const handleReset = useCallback(() => {
    onReset();
    onClose();
  }, [onReset, onClose]);

  if (!isOpen) return null;

  const visibleCount = draft.filter((c) => c.visible).length;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {visibleCount} of {draft.length} columns visible · drag to reorder
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close column settings"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Column List */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {draft.map((col, idx) => (
            <div
              key={col.key}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2.5 px-2 py-2 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${
                draggedIdx === idx
                  ? 'opacity-40 bg-indigo-50 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
                  : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              {/* Position Number */}
              <span className="w-5 text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                {idx + 1}
              </span>

              {/* Drag Handle */}
              <GripVertical size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />

              {/* Checkbox */}
              <input
                type="checkbox"
                checked={col.visible}
                disabled={!!col.required}
                onChange={() => handleToggle(col.key)}
                className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed shrink-0"
                aria-label={`Toggle column: ${col.label}`}
              />

              {/* Label */}
              <span
                className={`flex-1 text-xs font-medium ${
                  col.visible
                    ? 'text-slate-800 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-500 line-through'
                }`}
              >
                {col.label}
              </span>

              {/* Lock Icon for required columns */}
              {col.required && (
                <span title="Required column – cannot be hidden" className="shrink-0 flex items-center"><Lock size={11} className="text-slate-400 dark:text-slate-500" /></span>
              )}
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
            Reset to Default
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

