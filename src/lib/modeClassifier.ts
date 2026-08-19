export type ExecutionMode = 'auto' | 'quick_panel' | 'deep_council';
export type ResolvedExecutionMode = 'quick_panel' | 'deep_council';

export interface FileAttachment {
  name: string;
  content: string;
  type?: string;
}

/**
 * Classifies a user request into 'quick_panel' or 'deep_council'.
 * Adheres strictly to classification rules without relying on query length alone.
 */
export function classifyQueryMode(
  query: string,
  attachedFiles?: FileAttachment[]
): ResolvedExecutionMode {
  const qLower = query.toLowerCase().trim();

  // 1. Explicit Keywords that demand Deep Council
  const deepKeywords = [
    'analyze',
    'investigate',
    'compare deeply',
    'critique',
    'deliberate',
    'debug',
    'bug',
    'code',
    'refactor',
    'architecture',
    'legal',
    'medical',
    'financial',
    'audit',
    'security',
    'benchmark',
    'tradeoff',
    'trade-off',
    'system design',
    'deep dive',
    'deepen',
    'pull request',
    'review code',
    'stack trace',
    'vulnerability',
    'contract',
    'regulatory',
  ];

  if (deepKeywords.some((kw) => qLower.includes(kw))) {
    return 'deep_council';
  }

  // 2. Check attached files: Code files, PDFs, or large text documents trigger Deep Council
  if (attachedFiles && attachedFiles.length > 0) {
    const isCodeOrDocFile = attachedFiles.some((f) => {
      const ext = f.name.toLowerCase();
      return (
        ext.endsWith('.js') ||
        ext.endsWith('.ts') ||
        ext.endsWith('.tsx') ||
        ext.endsWith('.jsx') ||
        ext.endsWith('.py') ||
        ext.endsWith('.java') ||
        ext.endsWith('.cpp') ||
        ext.endsWith('.c') ||
        ext.endsWith('.cs') ||
        ext.endsWith('.go') ||
        ext.endsWith('.rs') ||
        ext.endsWith('.pdf') ||
        ext.endsWith('.json') ||
        ext.endsWith('.csv') ||
        ext.endsWith('.sql')
      );
    });

    const totalAttachedChars = attachedFiles.reduce((acc, f) => acc + (f.content?.length || 0), 0);

    if (isCodeOrDocFile || totalAttachedChars > 1200) {
      return 'deep_council';
    }
  }

  // 3. Structural triggers for Deep Council (multiple constraints or numbered requirements)
  const constraintMarkers = [
    'must include',
    'constraints:',
    'requirements:',
    'edge cases',
    'pros and cons',
    'compare and contrast',
    'which is better',
    'step-by-step reasoning',
  ];

  if (constraintMarkers.some((marker) => qLower.includes(marker))) {
    return 'deep_council';
  }

  // 4. Quick Panel triggers (Recipes, rewriting, summaries, brainstorming, simple questions, formatting)
  const quickKeywords = [
    'recipe',
    'rewrite',
    'summarize',
    'summary',
    'brainstorm',
    'format',
    'proofread',
    'grammar',
    'translate',
    'explain simply',
    'tldr',
    'tl;dr',
    'bullet points',
    'ideas for',
    'caption',
    'headline',
    'tagline',
    'email draft',
  ];

  if (quickKeywords.some((kw) => qLower.includes(kw))) {
    return 'quick_panel';
  }

  // 5. Default fallback for simple everyday requests: Quick Panel
  return 'quick_panel';
}

/**
 * Resolves the actual mode based on the user's selected mode setting.
 * If user selected 'quick_panel' or 'deep_council', that ALWAYS overrides Auto.
 */
export function resolveExecutionMode(
  selectedMode: ExecutionMode,
  query: string,
  attachedFiles?: FileAttachment[]
): ResolvedExecutionMode {
  if (selectedMode === 'quick_panel') return 'quick_panel';
  if (selectedMode === 'deep_council') return 'deep_council';
  return classifyQueryMode(query, attachedFiles);
}
