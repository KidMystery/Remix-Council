/**
 * Title summarization and prompt extraction utilities.
 * Transforms user prompts and questions into concise, human-readable thread titles.
 */

export const DEFAULT_THREAD_TITLE = 'New Deliberation';
export const DEFAULT_ORACLE_TITLE = 'New Conversation';

const KNOWN_ACRONYMS = new Set([
  'AI', 'ML', 'LLM', 'GPT', 'NLP', 'UI', 'UX', 'API', 'APIS', 'SDK', 'SDKS',
  'REST', 'GRAPHQL', 'SQL', 'NOSQL', 'POSTGRES', 'POSTGRESQL', 'MYSQL', 'SQLITE',
  'REDIS', 'MONGODB', 'AWS', 'GCP', 'AZURE', 'DOCKER', 'KUBERNETES', 'K8S',
  'CI/CD', 'CLI', 'SSH', 'HTTP', 'HTTPS', 'URL', 'URLS', 'JSON', 'YAML', 'XML',
  'HTML', 'CSS', 'JS', 'TS', 'SEO', 'B2B', 'B2C', 'ROI', 'SAAS', 'ARR', 'MRR',
  'KPI', 'KPIS', 'PDF', 'PR', 'PRS', 'TTS', 'ELO', 'GPU', 'GPUS', 'CPU', 'CPUS',
  'RAM', 'SSD', 'DNS', 'IP', 'VPN', 'JWT', 'OAUTH', 'WEBSOCKET', 'WEBSOCKETS'
]);

const ACRONYM_DISPLAY_MAP: Record<string, string> = {
  ai: 'AI',
  ml: 'ML',
  llm: 'LLM',
  gpt: 'GPT',
  nlp: 'NLP',
  ui: 'UI',
  ux: 'UX',
  api: 'API',
  apis: 'APIs',
  sdk: 'SDK',
  sdks: 'SDKs',
  rest: 'REST',
  graphql: 'GraphQL',
  sql: 'SQL',
  nosql: 'NoSQL',
  postgres: 'Postgres',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  redis: 'Redis',
  mongodb: 'MongoDB',
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  k8s: 'K8s',
  'ci/cd': 'CI/CD',
  cli: 'CLI',
  ssh: 'SSH',
  http: 'HTTP',
  https: 'HTTPS',
  url: 'URL',
  urls: 'URLs',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  js: 'JS',
  ts: 'TS',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  react: 'React',
  'next.js': 'Next.js',
  nextjs: 'Next.js',
  vue: 'Vue',
  svelte: 'Svelte',
  'node.js': 'Node.js',
  nodejs: 'Node.js',
  python: 'Python',
  golang: 'Go',
  rust: 'Rust',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ios: 'iOS',
  android: 'Android',
  macos: 'macOS',
  linux: 'Linux',
  seo: 'SEO',
  b2b: 'B2B',
  b2c: 'B2C',
  roi: 'ROI',
  saas: 'SaaS',
  arr: 'ARR',
  mrr: 'MRR',
  kpi: 'KPI',
  kpis: 'KPIs',
  pdf: 'PDF',
  pr: 'PR',
  prs: 'PRs',
  tts: 'TTS',
  elo: 'ELO',
  gpu: 'GPU',
  gpus: 'GPUs',
  cpu: 'CPU',
  cpus: 'CPUs',
  ram: 'RAM',
  ssd: 'SSD',
  dns: 'DNS',
  ip: 'IP',
  vpn: 'VPN',
  jwt: 'JWT',
  oauth: 'OAuth',
  websocket: 'WebSocket',
  websockets: 'WebSockets',
  'vs.': 'vs',
  vs: 'vs',
};

const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'vs', 'via', 'into', 'onto', 'and', 'or', 'nor', 'but'
]);

const STORY_OPENER = /^(anyway|okay so|ok so|okay|ok|well|so basically|so|like|um|uh|greetings|hello|hi there|hey there|hi|hey)\s*(?:oracle|council|bot|ai|there)?\b[,:\s]*|^(oracle|council)\b[,:\s]*/i;

const PROMPT_META_PREFIX = /^(user prompt|prompt|question|query|task|goal|directive|topic|case|issue|ask)\s*[:#-]+\s*/i;

const ASK_WRAPPER =
  /^(can you please|could you please|would you please|can you|could you|would you|please|i was wondering if you could|i was wondering|i would like to know if|i would like to know|i'd like to know|i'd like to understand|i want to know|i want to understand|i need to know|i need help with|i need a plan to|i need to|i need a|i want to|i'd like to|i am looking for|i'm looking for|tell me how to|tell me how|tell me about|tell me what|tell me|help me with|help me to|help me understand|help me|give me an overview of|give me a breakdown of|give me advice on|give me|show me how to|show me how|show me|provide a summary of|provide an executive summary of|provide a breakdown of|provide me with|provide a|what is the difference between|what are the differences between|what is the best way to|what's the best way to|what is a|what is an|what is the|what are the|what is|what are|what does|what do you think about|what do|how do i|how can i|how can we|how should we|how does|how to|why does|why do|why is|why are|when should i|when should we|where can i|which is better|deliberate on whether|deliberate on)\s+/i;


const COMPARISON_PATTERN = /^(?:difference between|differences between|comparing|compare|choose between|choosing between)\s+(.+?)\s+(?:and|vs|versus)\s+(.+)$/i;

const LEADING_ARTICLES = /^(the\s+|a\s+|an\s+|to\s+)/i;

const ASK_HINT = /\?|\b(help|fix|plan|need|should|figure out|what do i|how do i|how to|why is|why does|compare|difference|recommend|architect|design|build|create|review|debug|deploy|optimize|analyze|explain)\b/i;

/**
 * Checks if a thread title is a generic default or placeholder
 */
export function isDefaultTitle(title: unknown): boolean {
  if (typeof title !== 'string') return true;
  const clean = title.trim().toLowerCase();
  if (!clean) return true;
  return (
    clean === 'new deliberation' ||
    clean === 'new conversation' ||
    clean === 'new thread' ||
    clean === 'new consultation' ||
    clean === 'new session' ||
    clean === 'untitled' ||
    clean === 'untitled session' ||
    clean === 'untitled conversation' ||
    clean === 'conversation' ||
    clean === 'deliberation' ||
    clean === 'thread' ||
    clean === 'session'
  );
}

/**
 * Strips code blocks, file attachment blocks, and markdown markers
 */
function stripFormattingAndNoise(text: string): string {
  let clean = text;

  // Remove file markers and code blocks
  clean = clean.replace(/\[Attached Files?:\s*[^\]]+\]/gi, '');
  clean = clean.replace(/--- Attached File:[^\n]+\n/gi, '');
  clean = clean.replace(/\[CODEBASE FILE (?:CONTENTS|TREE)\][\s\S]*?(\n\n|$)/gi, '');
  clean = clean.replace(/\[Exhibit:[^\]]+\]/gi, '');
  clean = clean.replace(/```[a-z]*\n[\s\S]*?\n```/gi, '');
  clean = clean.replace(/`([^`]+)`/g, '$1');

  // Remove markdown headers, bold, italics, blockquotes, bullets
  clean = clean.replace(/^#{1,6}\s+/gm, '');
  clean = clean.replace(/(\*\*|__)(.*?)\1/g, '$2');
  clean = clean.replace(/(\*|_)(.*?)\1/g, '$2');
  clean = clean.replace(/^>\s+/gm, '');
  clean = clean.replace(/^[-*+]\s+/gm, '');
  clean = clean.replace(/^\d+\.\s+/gm, '');

  // Remove XML / HTML tags
  clean = clean.replace(/<[^>]+>/g, '');

  // Normalize whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
}

/**
 * Recursively strips conversational filler, story openers, and polite ask wrappers
 */
function stripFiller(text: string): string {
  let phrase = text.trim();

  // Strip prompt meta prefixes (e.g., "Prompt: ...", "Question: ...")
  phrase = phrase.replace(PROMPT_META_PREFIX, '').trim();

  // Check for "What is the difference between A and B" or "Difference between A and B"
  const diffMatch = phrase.match(/^(?:what is the difference between|what are the differences between|difference between|differences between)\s+(.+?)\s+(?:and|vs|versus)\s+(.+)$/i);
  if (diffMatch && diffMatch[1] && diffMatch[2]) {
    const a = diffMatch[1].trim();
    const b = diffMatch[2].replace(/[?.!]+$/g, '').trim();
    if (a && b) {
      return `${a} vs ${b}`;
    }
  }

  for (let i = 0; i < 4; i++) {
    const withoutOpener = phrase.replace(STORY_OPENER, '').trim();
    const withoutWrapper = withoutOpener.replace(ASK_WRAPPER, '').trim();
    if (withoutWrapper === phrase) break;
    phrase = withoutWrapper;
  }

  // Handle comparison questions cleanly ("Compare Docker vs Kubernetes" / "Difference between A and B")
  const compMatch = phrase.match(COMPARISON_PATTERN);
  if (compMatch && compMatch[1] && compMatch[2]) {
    const a = compMatch[1].trim();
    const b = compMatch[2].replace(/[?.!]+$/g, '').trim();
    if (a && b) {
      return `${a} vs ${b}`;
    }
  }

  // Clean leading dangling prepositions / articles if appropriate
  if (/^(to|the|a|an)\s+/i.test(phrase)) {
    const withoutArticle = phrase.replace(LEADING_ARTICLES, '').trim();
    if (withoutArticle.length >= 3) {
      phrase = withoutArticle;
    }
  }

  return phrase;
}

/**
 * Finds the most relevant sentence / core question in a multi-sentence prompt
 */
function findCoreAsk(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  if (sentences.length <= 1) return text;

  // Search in reverse for explicitly asked questions (?) or strong intent hints
  const questionSentence = [...sentences].reverse().find((s) => s.includes('?'));
  if (questionSentence) return questionSentence;

  const hintedSentence = [...sentences].reverse().find((s) => ASK_HINT.test(s));
  if (hintedSentence) return hintedSentence;

  return sentences[0] || text;
}

/**
 * Casing helper that preserves original words while formatting acronyms and capitalization
 */
function formatTitleCase(phrase: string): string {
  const words = phrase.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  return words
    .map((rawWord) => {
      const lower = rawWord.toLowerCase().replace(/[^a-z0-9/.-]/g, '');
      const cleanRaw = rawWord.replace(/^[("'[{]+|[)"'\]},:;]+$/g, '');

      // Check if known acronym/brand
      if (ACRONYM_DISPLAY_MAP[lower]) {
        return ACRONYM_DISPLAY_MAP[lower];
      }
      if (KNOWN_ACRONYMS.has(cleanRaw.toUpperCase())) {
        return cleanRaw.toUpperCase();
      }

      return rawWord;
    })
    .join(' ');
}

/**
 * Summarizes user questions and prompts into clean, elegant thread titles.
 *
 * Examples:
 * - "Can you please analyze this financial statement?" -> "Analyze Financial Statement"
 * - "How do I build an async pipeline in TypeScript?" -> "Build Async Pipeline in TypeScript"
 * - "What is the difference between Postgres and MySQL?" -> "Postgres vs MySQL"
 * - "Why does useEffect run twice in React 18?" -> "Why useEffect Runs Twice in React 18"
 */
export function summarizeTitle(text: unknown, defaultFallback = DEFAULT_THREAD_TITLE): string {
  if (typeof text !== 'string' || !text.trim()) return defaultFallback;

  const cleaned = stripFormattingAndNoise(text);
  if (!cleaned) return defaultFallback;

  const wordsIn = cleaned.split(/\s+/).filter(Boolean);
  const core = wordsIn.length > 25 || cleaned.length > 140 ? findCoreAsk(cleaned) : cleaned;

  let phrase = stripFiller(core).replace(/[?.!:,;]+$/g, '').trim();
  if (!phrase || phrase.length < 3) {
    phrase = stripFiller(cleaned).replace(/[?.!:,;]+$/g, '').trim() || cleaned;
  }

  // Remove trailing or leading noise
  phrase = phrase.replace(/^[^\w#@]+|[^\w#@]+$/g, '').trim();

  // Format into proper casing
  let formatted = formatTitleCase(phrase);
  if (!formatted) formatted = defaultFallback;

  // Enforce length and word limits cleanly
  const words = formatted.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    formatted = words.slice(0, 8).join(' ');
  }

  if (formatted.length > 44) {
    const trimmed = formatted.slice(0, 42).trimEnd();
    // Trim at word boundary if possible
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace > 20) {
      formatted = trimmed.slice(0, lastSpace).trimEnd() + '...';
    } else {
      formatted = trimmed + '...';
    }
  } else if (words.length > 8) {
    formatted += '...';
  }

  // Ensure first character is uppercase
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

