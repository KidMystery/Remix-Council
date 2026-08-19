export interface ParsedGitHubUrl {
  isValid: boolean;
  error?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  path?: string;
  isRawFile?: boolean;
  downloadArchiveUrl?: string;
  apiUrl?: string;
}

const APPROVED_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'codeload.github.com',
]);

const PRIVATE_IP_REGEX = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|::1)$/i;

export function validateAndParseGitHubUrl(rawUrl: string): ParsedGitHubUrl {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, error: 'URL must be a non-empty string.' };
  }

  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { isValid: false, error: 'Invalid URL format.' };
  }

  // Reject non-HTTPS
  if (parsed.protocol !== 'https:') {
    return { isValid: false, error: 'Only secure HTTPS GitHub URLs are supported.' };
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'URLs containing embedded credentials are not permitted.' };
  }

  // Reject non-standard ports
  if (parsed.port && parsed.port !== '443') {
    return { isValid: false, error: 'Custom ports are not allowed.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject private IPs, localhost
  if (PRIVATE_IP_REGEX.test(hostname)) {
    return { isValid: false, error: 'Access to private network addresses or localhost is forbidden.' };
  }

  // Approve only recognized GitHub domains
  if (!APPROVED_HOSTS.has(hostname)) {
    return { isValid: false, error: `Host '${hostname}' is not a supported GitHub domain.` };
  }

  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (hostname === 'raw.githubusercontent.com') {
    // /owner/repo/ref/path...
    if (pathParts.length < 3) {
      return { isValid: false, error: 'Raw GitHub URL must include owner, repo, and ref.' };
    }
    const owner = pathParts[0];
    const repo = pathParts[1].replace(/\.git$/i, '');
    const ref = pathParts[2];
    const filePath = pathParts.slice(3).join('/');

    return {
      isValid: true,
      owner,
      repo,
      ref,
      path: filePath,
      isRawFile: true,
      apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
    };
  }

  // github.com
  if (pathParts.length < 2) {
    return { isValid: false, error: 'GitHub URL must specify at least /owner/repository.' };
  }

  const owner = pathParts[0];
  const repo = pathParts[1].replace(/\.git$/i, '');

  if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
    return { isValid: false, error: 'Repository owner and name contain invalid characters.' };
  }

  let ref = 'main';
  let filePath: string | undefined = undefined;
  let isRawFile = false;

  if (pathParts.length >= 4 && (pathParts[2] === 'blob' || pathParts[2] === 'raw')) {
    ref = pathParts[3];
    filePath = pathParts.slice(4).join('/');
    isRawFile = true;
  } else if (pathParts.length >= 4 && pathParts[2] === 'tree') {
    ref = pathParts[3];
    filePath = pathParts.slice(4).join('/');
  }

  return {
    isValid: true,
    owner,
    repo,
    ref,
    path: filePath,
    isRawFile,
    downloadArchiveUrl: `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${ref}`,
    apiUrl: `https://api.github.com/repos/${owner}/${repo}`,
  };
}
