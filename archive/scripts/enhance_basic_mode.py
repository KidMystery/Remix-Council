import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# Replace Stage 1 header block to support Basic Mode summary line + click-to-expand toggle
stage1_header_old = """              {/* Stage 1: Initial Proposals / Quick Panel Answers */}
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    {round.resolvedMode === 'quick_panel' ? (
                      <span className="text-amber-300 flex items-center gap-1.5">
                        <Zap size={13} className="text-amber-400" />
                        Quick Panel Responses
                      </span>
                    ) : Object.keys(round.deliberation?.stage1 || {}).length <= 1 ? (
                      'Single Council Member Evaluation'
                    ) : (
                      'Stage 1: Initial Proposals'
                    )}
                  </h3>
                </div>"""

stage1_header_new = """              {/* Stage 1: Initial Proposals / Quick Panel Answers */}
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
                    {basicMode && (
                      <span className="text-[10px] lowercase font-normal px-2 py-0.5 rounded bg-cyan-950/40 text-cyan-400 border border-cyan-800/50 ml-1">
                        ✓ {Object.keys(round.deliberation?.stage1 || {}).length} responses logged
                      </span>
                    )}
                  </h3>
                </div>"""

content = content.replace(stage1_header_old, stage1_header_new)

# Replace Stage 2 header block to support Basic Mode summary badge
stage2_header_old = """              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}
              {round.resolvedMode === 'deep_council' &&
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
                    </div>"""

stage2_header_new = """              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}
              {round.resolvedMode === 'deep_council' &&
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
                        {basicMode && (
                          <span className="text-[10px] lowercase font-normal px-2 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-800/50 ml-1">
                            ✓ Peer review completed
                          </span>
                        )}
                      </h3>
                    </div>"""

content = content.replace(stage2_header_old, stage2_header_new)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

print("Enhanced Basic Mode headers")
