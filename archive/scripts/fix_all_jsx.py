import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    code = f.read()

# Fix header cost badge
code = re.sub(
    r'<p className="text-\[11px\].*?Multi-Model Deliberation Engine</span>\s*\{!basicMode && \(.*?</p>',
    '''<p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>Multi-Model Deliberation Engine</span>
                {!basicMode && (
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-800/60 shadow-sm"
                    title={`Total Tokens: ${sessionCostMetrics.totalTokens.toLocaleString()}\\n• Prompt Tokens: ${sessionCostMetrics.promptTokens.toLocaleString()} (${formatCost(sessionCostMetrics.promptCost)})\\n• Completion Tokens: ${sessionCostMetrics.completionTokens.toLocaleString()} (${formatCost(sessionCostMetrics.completionCost)})`}
                  >
                    <DollarSign size={11} className="text-emerald-400" />
                    <span className="font-bold">{formatCost(sessionCostMetrics.totalCost)}</span>
                    <span className="text-slate-500 dark:text-slate-400 text-[9px] border-l border-emerald-800/80 pl-1.5">
                      {sessionCostMetrics.promptTokens > 1000 ? `${(sessionCostMetrics.promptTokens / 1000).toFixed(1)}k in` : `${sessionCostMetrics.promptTokens} in`} / {sessionCostMetrics.completionTokens > 1000 ? `${(sessionCostMetrics.completionTokens / 1000).toFixed(1)}k out` : `${sessionCostMetrics.completionTokens} out`}
                    </span>
                  </span>
                )}
              </p>''',
    code,
    flags=re.DOTALL
)

# Fix Stage 1 & Stage 2 wrapper
stage1_pattern = r'\{/\* Stage 1: Initial Proposals / Quick Panel Answers \*/\}.*?\{/\* Stage 3: Consensus & Unified Path Forward \*/\}'

stage1_replacement = '''{/* Stage 1: Initial Proposals / Quick Panel Answers */}
              {!basicMode && (
                <div className="space-y-3 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      {round.resolvedMode === 'quick_panel' ? (
                        <span className="text-amber-300 flex items-center gap-1.5">
                          <Zap size={13} className="text-amber-400" />
                          Stage 1: Quick Panel Responses
                        </span>
                      ) : Object.keys(round.deliberation?.stage1 || {}).length <= 1 ? (
                        'Stage 1: Single Council Member Evaluation'
                      ) : (
                        'Stage 1: Initial Proposals'
                      )}
                    </h3>
                  </div>
                  <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">
                    {personas
                      .filter((persona) => round.deliberation?.stage1?.[persona.id] || persona.enabled !== false)
                      .map((persona) => {
                        const resp = round.deliberation?.stage1?.[persona.id] || (round as any).responses?.[persona.id];
                        const copyKey = `${round.id}-stage1-${persona.id}`;
                        return (
                          <div
                            key={persona.id}
                            className={`p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900/90 dark:bg-slate-800/90 dark:bg-white dark:bg-slate-900/80 border ${persona.color} flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md transition-all duration-200 min-w-0 max-w-full overflow-hidden break-words h-full`}
                          >
                            <div className="space-y-3 min-w-0">
                              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2.5 min-w-0 gap-2">
                                <div className="flex items-center space-x-2.5 min-w-0 truncate">
                                  <span className="text-xl shrink-0">{persona.avatar}</span>
                                  <div className="min-w-0 truncate">
                                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 leading-tight truncate">{persona.name}</h3>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{persona.role}</p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={isDeliberating}
                                    onClick={() => handleRegeneratePersona(round.id, persona.id, 1)}
                                    className="text-slate-500 dark:text-slate-400 hover:text-cyan-300 disabled:opacity-30 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                    title="Regenerate persona proposal"
                                  >
                                    <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-cyan-400' : ''} />
                                  </button>
                                  {resp?.content && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => speak(resp.content, copyKey)}
                                        className={`transition-colors p-1.5 rounded hover:bg-slate-100/80 ${
                                          speakingId === copyKey ? 'text-cyan-400 bg-cyan-950/60 animate-pulse' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                                        } flex items-center gap-1 font-medium text-[10px]`}
                                        title={speakingId === copyKey ? 'Stop reading' : 'Read response aloud'}
                                      >
                                        {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                                        <span>{speakingId === copyKey ? 'Stop' : 'Listen'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(copyKey, resp.content)}
                                        className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                        title="Copy response"
                                      >
                                        {copiedId === copyKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {resp?.status === 'error' ? (
                                <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 min-w-0 break-words">
                                  Error: {resp.error}
                                </div>
                              ) : resp?.content ? (
                                <div className="min-w-0 max-w-full overflow-x-auto break-words">
                                  <MessageMarkdown content={resp.content} />
                                </div>
                              ) : (
                                <ThinkingIndicator
                                  stageLabel={round.resolvedMode === 'quick_panel' ? 'Quick Answer' : 'Stage 1 Proposal'}
                                  personaName={persona.name}
                                  role={persona.role}
                                  model={persona.model || settings.defaultModels[persona.id]}
                                  accentColor="cyan"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  {/* Missing Panelist Indicator */}
                  {(() => {
                    const missing = personas.filter(
                      (p) => p.enabled !== false && round.deliberation?.stage1?.[p.id]?.status === 'error'
                    );
                    if (missing.length === 0) return null;
                    return (
                      <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 p-2.5 rounded-xl flex items-center gap-2">
                        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                        <span>Missing panelist responses: <strong>{missing.map((p) => p.name).join(', ')}</strong> (timed out or error)</span>
                      </div>
                    );
                  })()}
                  {/* Quick Panel Actions Bar */}
                  {round.resolvedMode === 'quick_panel' && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 p-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <Zap size={14} className="text-amber-400" />
                        <span>Quick Panel Execution Complete</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {(!round.synthesis?.content && round.synthesis?.status !== 'streaming') && (
                          <button
                            type="button"
                            disabled={
                              isDeliberating ||
                              Object.values(round.deliberation?.stage1 || {}).filter((r: PersonaResponse | any) => r.status === 'completed').length < 2
                            }
                            onClick={() => runQuickPanelSynthesis(round.id)}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
                            title="Synthesize panelist answers into a single consolidated view"
                          >
                            <Sparkles size={13} />
                            <span>Synthesize Answers</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isDeliberating}
                          onClick={() => handleDeepenAnswer(round.id)}
                          className="px-3 py-1.5 rounded-lg bg-purple-950 hover:bg-purple-900 text-purple-200 border border-purple-700/60 font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-40"
                          title="Run full 3-stage Deep Council peer review on this query"
                        >
                          <Layers size={13} className="text-purple-400" />
                          <span>Deepen this answer 🏛️</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}
              {!basicMode &&
                round.resolvedMode === 'deep_council' &&
                Object.keys(round.deliberation?.stage1 || {}).length > 1 &&
                round.deliberation?.stage2 &&
                Object.values(round.deliberation.stage2).some(
                  (resp: PersonaResponse | any) => resp?.content || resp?.status === 'streaming'
                ) && (
                  <div className="space-y-3 pt-2 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                        Stage 2: Peer Review & Cross-Examination
                      </h3>
                    </div>
                    <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">
                      {personas
                        .filter((persona) => round.deliberation?.stage2?.[persona.id])
                        .map((persona) => {
                          const resp = round.deliberation?.stage2?.[persona.id];
                          const copyKey = `${round.id}-stage2-${persona.id}`;
                          if (!resp) return null;
                          return (
                            <div
                              key={`s2-${persona.id}`}
                              className={`p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900/90 dark:bg-slate-800/90 dark:bg-white dark:bg-slate-900/80 border ${persona.color} flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md transition-all duration-200 min-w-0 max-w-full overflow-hidden break-words h-full`}
                            >
                              <div className="space-y-3 min-w-0">
                                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2.5 min-w-0 gap-2">
                                  <div className="flex items-center space-x-2.5 min-w-0 truncate">
                                    <span className="text-xl shrink-0">{persona.avatar}</span>
                                    <div className="min-w-0 truncate">
                                      <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 leading-tight truncate">{persona.name}</h3>
                                      <p className="text-[11px] text-purple-300/80 truncate">Peer Review</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1 shrink-0">
                                    <button
                                      type="button"
                                      disabled={isDeliberating}
                                      onClick={() => handleRegeneratePersona(round.id, persona.id, 2)}
                                      className="text-slate-500 dark:text-slate-400 hover:text-purple-300 disabled:opacity-30 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                      title="Regenerate peer review"
                                    >
                                      <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-purple-400' : ''} />
                                    </button>
                                    {resp?.content && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => speak(resp.content, copyKey)}
                                          className={`transition-colors p-1.5 rounded hover:bg-slate-100/80 ${
                                            speakingId === copyKey ? 'text-purple-400 bg-purple-950/60 animate-pulse' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                                          } flex items-center gap-1 font-medium text-[10px]`}
                                          title={speakingId === copyKey ? 'Stop reading' : 'Read response aloud'}
                                        >
                                          {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                                          <span>{speakingId === copyKey ? 'Stop' : 'Listen'}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(copyKey, resp.content)}
                                          className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                          title="Copy response"
                                        >
                                          {copiedId === copyKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {resp?.status === 'error' ? (
                                  <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 min-w-0 break-words">
                                    Error: {resp.error}
                                  </div>
                                ) : resp?.content ? (
                                  <div className="min-w-0 max-w-full overflow-x-auto break-words">
                                    <MessageMarkdown content={resp.content} />
                                  </div>
                                ) : (
                                  <ThinkingIndicator
                                    stageLabel="Stage 2 Peer Review"
                                    personaName={persona.name}
                                    role="Peer Reviewer"
                                    model={persona.model || settings.defaultModels[persona.id]}
                                    accentColor="purple"
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

              {/* Phase 2: Blind Pro Side-by-Side Comparison Card */}
              {!basicMode && round.proComparisonData && (
                <CompareProCard
                  auditLogId={round.proComparisonData.auditLogId}
                  userQuery={round.userQuery}
                  proModelId={round.proComparisonData.proModelId}
                  councilContent={round.synthesis.content}
                  proContent={round.proComparisonData.proContent}
                  councilLatencyMs={round.proComparisonData.councilLatencyMs}
                  proLatencyMs={round.proComparisonData.proLatencyMs}
                  councilCost={round.proComparisonData.councilCost}
                  proCost={round.proComparisonData.proCost}
                  answerAIsCouncil={round.proComparisonData.answerAIsCouncil}
                />
              )}

              {/* Stage 3: Consensus & Unified Path Forward */}'''

code = re.sub(stage1_pattern, stage1_replacement, code, flags=re.DOTALL)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(code)

print("Fixed JSX structure in CouncilChamber.tsx")
