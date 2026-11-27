/**
 * Central input & payload sanitization and code-execution prevention utilities.
 * Guards every writable text field, URL, and persisted JSON payload against
 * XSS, HTML injection, dangerous URI schemes, prototype pollution, and template injection.
 */

const CONTROL_CHARS_SINGLELINE_RE = /[\u0000-\u001F\u007F]/g;
const CONTROL_CHARS_MULTILINE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const DANGEROUS_TAG_RE =
  /<\s*\/?\s*(?:script|iframe|object|embed|svg|style|link|meta|base|form|input|textarea|button|select|img|video|audio|source|body|html|head|title|frame|frameset|applet|math|noscript)\b[^>]*>/i;

const GENERIC_HTML_TAG_RE = /<\/?[a-zA-Z!][a-zA-Z0-9:_-]*(?:\s[^>]*)?>/;
const EVENT_HANDLER_RE = /\bon[a-z]{2,24}\s*=/i;
const DANGEROUS_SCHEME_RE =
  /(?:javascript|vbscript|jscript|livescript)\s*:|data\s*:\s*(?:text\/html|application\/(?:x-)?javascript|image\/svg\+xml)/i;
const TEMPLATE_EXEC_RE =
  /\$\{[\s\S]*?\}|\{\{[\s\S]*?\}\}|<%[\s\S]*?%>|<\?(?:php|=)?/i;
const JS_RUNTIME_SINK_RE =
  /\b(?:eval|Function)\s*\(|\bdocument\s*\.\s*(?:cookie|write|writeln|domain|location)|\bwindow\s*\.\s*(?:location|open|eval)\b|\b(?:process\.env|require\s*\(|import\s*\()/i;
const PROTO_POLLUTION_KEY_RE =
  /(?:^|[^a-zA-Z0-9_])(?:__proto__|constructor|prototype)(?:[^a-zA-Z0-9_]|$)/;

const DATA_IMAGE_SAFE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

export interface TextSecurityOptions {
  maxLen?: number;
  allowNewlines?: boolean;
  required?: boolean;
}

export function containsDangerousCodePattern(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  if (CONTROL_CHARS_MULTILINE_RE.test(value)) return true;
  if (DANGEROUS_TAG_RE.test(value)) return true;
  if (GENERIC_HTML_TAG_RE.test(value)) return true;
  if (EVENT_HANDLER_RE.test(value)) return true;
  if (DANGEROUS_SCHEME_RE.test(value)) return true;
  if (TEMPLATE_EXEC_RE.test(value)) return true;
  if (JS_RUNTIME_SINK_RE.test(value)) return true;
  if (PROTO_POLLUTION_KEY_RE.test(value)) return true;
  return false;
}

export function sanitizePlainText(
  value: unknown,
  opts: TextSecurityOptions = {}
): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  const { maxLen = 500, allowNewlines = false } = opts;

  let cleaned = raw.replace(
    allowNewlines ? CONTROL_CHARS_MULTILINE_RE : CONTROL_CHARS_SINGLELINE_RE,
    allowNewlines ? '' : ' '
  );

  // Strip HTML tags & dangerous URI prefixes cleanly without harming normal punctuation
  cleaned = cleaned
    .replace(/<\s*\/?\s*(?:script|style)[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi, ' ')
    .replace(/<\/?[a-zA-Z!][a-zA-Z0-9:_-]*(?:\s[^>]*)?>/g, ' ')
    .replace(/(?:javascript|vbscript|jscript|livescript)\s*:/gi, '')
    .replace(/data\s*:\s*(?:text\/html|application\/(?:x-)?javascript|image\/svg\+xml)/gi, '')
    .replace(/\bon[a-z]{2,24}\s*=/gi, '')
    .replace(/\$\{([^}]*)\}/g, '$1')
    .replace(/\{\{([^}]*)\}\}/g, '$1')
    .replace(/<%([\s\S]*?)%>/g, '$1')
    .replace(/<\?(?:php|=)?/gi, '');

  if (allowNewlines) {
    cleaned = cleaned
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
  }

  return maxLen > 0 ? cleaned.slice(0, maxLen) : cleaned;
}

export function assertSafeTextInput(
  value: unknown,
  fieldLabel: string,
  opts: TextSecurityOptions = {}
): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (containsDangerousCodePattern(raw)) {
    throw new Error(
      `Por seguridad, el campo "${fieldLabel}" no permite etiquetas HTML, scripts ni código ejecutable.`
    );
  }
  const normalized = sanitizePlainText(raw, opts);
  if (opts.required && !normalized) {
    throw new Error(`El campo "${fieldLabel}" es obligatorio.`);
  }
  return normalized;
}

export function assertSafeEmailInput(value: unknown, fieldLabel = 'Correo electrónico'): string {
  const clean = assertSafeTextInput(value, fieldLabel, { maxLen: 160, allowNewlines: false }).toLowerCase();
  if (!clean) {
    throw new Error(`Ingresa un ${fieldLabel.toLowerCase()} válido.`);
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(clean)) {
    throw new Error(`El formato de "${fieldLabel}" no es válido.`);
  }
  return clean;
}

export function isSafeImageUrl(
  url: unknown,
  opts: { allowDataImage?: boolean; allowRelative?: boolean } = {}
): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (containsDangerousCodePattern(trimmed)) return false;

  const { allowDataImage = true, allowRelative = true } = opts;

  if (allowDataImage && DATA_IMAGE_SAFE_RE.test(trimmed)) {
    return true;
  }
  if (allowRelative && (trimmed.startsWith('/') || trimmed.startsWith('./'))) {
    return !trimmed.startsWith('//');
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return true;
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function sanitizeSafeUrl(
  url: unknown,
  opts: { allowDataImage?: boolean; allowRelative?: boolean; maxLen?: number } = {}
): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  const maxLen = opts.maxLen ?? 250000;
  if (!isSafeImageUrl(trimmed, opts)) return '';
  return trimmed.slice(0, maxLen);
}

export function sanitizeStringList(
  values: unknown,
  maxItems = 30,
  maxItemLen = 80
): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const clean = sanitizePlainText(item, { maxLen: maxItemLen });
    if (clean) out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw, (key, val) => {
      if (FORBIDDEN_JSON_KEYS.has(key)) return undefined;
      return val;
    });
    return (parsed === undefined ? fallback : parsed) as T;
  } catch {
    return fallback;
  }
}

/**
 * Installs a document-level form submission and blur validation guard so no writable
 * <input> or <textarea> anywhere in the DOM can submit executable HTML/JS payloads.
 */
export function installGlobalInputExecutionGuard(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const validateElement = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
    if (el.type === 'file' || el.type === 'hidden') return true;
    if (containsDangerousCodePattern(el.value)) {
      el.setCustomValidity(
        'Por seguridad, no se permite código de programación, etiquetas HTML ni scripts.'
      );
      return false;
    }
    el.setCustomValidity('');
    return true;
  };

  const handleInput = (e: Event) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (target.type === 'file' || target.type === 'hidden') return;
      if (containsDangerousCodePattern(target.value)) {
        target.setCustomValidity(
          'Por seguridad, no se permite código de programación, etiquetas HTML ni scripts.'
        );
      } else if (target.validationMessage) {
        target.setCustomValidity('');
      }
    }
  };

  const handleChange = (e: Event) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (!validateElement(target)) {
        target.reportValidity();
      }
    }
  };

  const handleSubmit = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const controls = form.querySelectorAll('input, textarea');
    for (const node of Array.from(controls)) {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (!validateElement(node)) {
          e.preventDefault();
          e.stopPropagation();
          node.focus();
          node.reportValidity();
          return;
        }
      }
    }
  };

  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('submit', handleSubmit, true);

  return () => {
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('change', handleChange, true);
    document.removeEventListener('submit', handleSubmit, true);
  };
}
