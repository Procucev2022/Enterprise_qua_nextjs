                    <strong>Subject:</strong>{' '}
                    {savedTemplateA?.subject ||
                      `${activeBuyerAccount?.organizationName || 'Larsen & Toubro'} has mapped your supply categories`}
                  </p>
                  {savedTemplateA?.message ? (
                    <p className="text-slate-600 dark:text-gray-300">{savedTemplateA.message}</p>
                  ) : (
                    <p className="text-emerald-700 dark:text-emerald-400 font-bold">
                      • 1st Set: Engineering Spares - Mechanical<br />
                      • 2nd Set: Pumps, Valves, Hoses, Machinery Parts
                    </p>
                  )}
                  <p className="text-slate-400">• Vendor code & categories table + Sign-in link always included</p>
                </div>
              </div>

              {/* Template B Preview: Unmapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-amber-900 dark:text-amber-200 text-[11px] flex items-center gap-1">
                    <AlertCircle size={13} className="text-amber-600" />
                    Template B: Suppliers With NO Pre-Purchase Orders ({unmappedVendors.length})
                  </span>
                  {(savedTemplateB?.subject || savedTemplateB?.message) && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 shrink-0">
                      Customized
                    </span>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 text-[10px] space-y-1 font-mono text-slate-700 dark:text-gray-300">
                  <p>
                    <strong>Subject:</strong>{' '}
                    {savedTemplateB?.subject || 'Complete Your Category Mapping to Receive Enquiries'}
                  </p>
                  {savedTemplateB?.message ? (
                    <p className="text-slate-600 dark:text-gray-300">{savedTemplateB.message}</p>
                  ) : (
                    <p className="text-amber-700 dark:text-amber-400 font-bold">
                      • &quot;Buyer didn&apos;t map any categories for you, so please map yourself in order to receive enquiries.&quot;
                    </p>
                  )}
                  <p className="text-slate-400">• Vendor code & categories table + Sign-in link always included</p>
                </div>
              </div>
            </div>

            {/* Ingestion Totals Grid */}
            <div className="grid grid-cols-4 gap-2.5 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                <span className="text-[10px] text-slate-400 block">Total Stored</span>
                <span className="font-black text-slate-900 dark:text-white text-sm">{joinedVendors.length} Vendors</span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">PO Mapped</span>
                <span className="font-black text-emerald-700 dark:text-emerald-300 text-sm">{mappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
                <span className="text-[10px] text-amber-600 dark:text-amber-400 block">Self-Map Required</span>
                <span className="font-black text-amber-700 dark:text-amber-300 text-sm">{unmappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50">
                <span className="text-[10px] text-purple-600 dark:text-purple-400 block">3-Day Reminders</span>
                <span className="font-black text-purple-700 dark:text-purple-300 text-sm">Active (Day 3)</span>
              </div>
            </div>

            {/* Submission Error Banner */}
            {submissionError && (
              <div
                data-testid="step5-submission-error-banner"
                className="p-4 rounded-2xl bg-rose-50/90 dark:bg-rose-950/50 border-2 border-rose-300 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 flex items-start justify-between gap-3 animate-fade-in shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h5 className="font-bold text-xs uppercase tracking-wide text-rose-800 dark:text-rose-300">
                      Ingestion &amp; Dispatch Error
                    </h5>
                    <p className="text-xs font-medium leading-relaxed">{submissionError}</p>
                    <p className="text-[11px] text-rose-700/80 dark:text-rose-400/80">
                      Please verify your file data, network, or server connection and retry.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSubmissionError(null)}
                  className="p-1 text-rose-400 hover:text-rose-600 rounded-lg shrink-0"
                  title="Dismiss error"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => navigateToStep(4)}
                className="btn btn-secondary btn-sm"
                disabled={isConfirmingIngestion}
              >
                Back to Category Join
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalIngestion}
                disabled={isConfirmingIngestion}
                className="btn btn-primary font-bold text-xs py-3 px-6 shadow-lg shadow-indigo-600/30 flex items-center gap-2 disabled:opacity-60"
              >
                <CheckCircle2 size={16} />{' '}
                {isConfirmingIngestion ? 'PROCESSING...' : `[ COMPLETE SETUP & INGEST ${joinedVendors.length} VENDORS ]`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  }