import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# 1. Update 'Speak' button text to 'Listen' across all responses
content = content.replace(
    "<span>{speakingId === copyKey ? 'Stop' : 'Speak'}</span>",
    "<span>{speakingId === copyKey ? 'Stop' : 'Listen'}</span>"
)
content = content.replace(
    "<span>{speakingId === `${round.id}-synthesis` ? 'Stop' : 'Speak'}</span>",
    "<span>{speakingId === `${round.id}-synthesis` ? 'Stop' : 'Listen'}</span>"
)

# 2. In Header, hide cost badge when in basicMode
header_cost_badge_old = """                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-800/60 shadow-sm"
                  title={`Total Tokens: ${sessionCostMetrics.totalTokens.toLocaleString()}\\n• Prompt Tokens: ${sessionCostMetrics.promptTokens.toLocaleString()} (${formatCost(sessionCostMetrics.promptCost)})\\n• Completion Tokens: ${sessionCostMetrics.completionTokens.toLocaleString()} (${formatCost(sessionCostMetrics.completionCost)})`}
                >"""

header_cost_badge_new = """                {!basicMode && (
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
                )}"""

content = content.replace(header_cost_badge_old, header_cost_badge_new)

# 3. Hide interrupted deliberation banner in basic mode
interrupted_banner_old = """      {/* Main Content Feed */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 space-y-6 pb-32">
        {(() => {
          const activePersonas = personas.filter((p) => p.enabled !== false);
          const firstIncomplete = rounds.find((r) => getRoundIncompleteStage(r, activePersonas).isIncomplete);
          if (!firstIncomplete) return null;"""

interrupted_banner_new = """      {/* Main Content Feed */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 space-y-6 pb-32">
        {(() => {
          if (basicMode) return null;
          const activePersonas = personas.filter((p) => p.enabled !== false);
          const firstIncomplete = rounds.find((r) => getRoundIncompleteStage(r, activePersonas).isIncomplete);
          if (!firstIncomplete) return null;"""

content = content.replace(interrupted_banner_old, interrupted_banner_new)

# 4. Hide Stage 1 completely when in basic mode
stage1_start_old = """              {/* Stage 1: Initial Proposals / Quick Panel Answers */}
              <div className="space-y-3 min-w-0">"""

stage1_start_new = """              {/* Stage 1: Initial Proposals / Quick Panel Answers */}
              {!basicMode && (
              <div className="space-y-3 min-w-0">"""

# Close stage 1 !basicMode block before Stage 2
stage2_start_old = """              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}"""

stage2_start_new = """              </div>
              )}

              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}
              {!basicMode && ("""

content = content.replace(stage1_start_old, stage1_start_new)
content = content.replace(stage2_start_old, stage2_start_new)

# Close stage 2 !basicMode block before Pro Comparison / Synthesis
synthesis_start_old = """              {/* Phase 2: Blind Pro Side-by-Side Comparison Card */}"""

synthesis_start_new = """              )}

              {/* Phase 2: Blind Pro Side-by-Side Comparison Card */}
              {!basicMode && ("""

# And close the pro comparison !basicMode block before Synthesis
synthesis_card_old = """              {/* Stage 3: Consensus & Unified Path Forward */}"""

synthesis_card_new = """              )}

              {/* Stage 3: Consensus & Unified Path Forward */}"""

content = content.replace(synthesis_start_old, synthesis_start_new)
content = content.replace(synthesis_card_old, synthesis_card_new)

# 5. Hide execution mode selector, quick persona toggle bar, and token estimates in basicMode at bottom
bottom_controls_old = """          {/* Mode Selector & Estimate Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 pb-1 text-xs">"""

bottom_controls_new = """          {/* Mode Selector & Estimate Bar */}
          {!basicMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 pb-1 text-xs">"""

persona_bar_old = """          {/* Quick Persona Toggle Bar */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">"""

persona_bar_new = """          </div>
          )}

          {/* Quick Persona Toggle Bar */}
          {!basicMode && (
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">"""

token_line_old = """          {(query.length > 0 || attachedFiles.length > 0) && ("""

token_line_new = """          </div>
          )}

          {!basicMode && (query.length > 0 || attachedFiles.length > 0) && ("""

form_start_old = """          <form 
            onSubmit={handleDeliberate}"""

form_start_new = """          )}

          <form 
            onSubmit={handleDeliberate}"""

content = content.replace(bottom_controls_old, bottom_controls_new)
content = content.replace(persona_bar_old, persona_bar_new)
content = content.replace(token_line_old, token_line_new)
content = content.replace(form_start_old, form_start_new)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

print("Applied updates successfully")
