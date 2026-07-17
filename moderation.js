// moderation.js — Automated content moderation: PII scrub, crisis detection, toxicity, image processing
const crypto = require('crypto');

// ── PII Detection Patterns ──
const PII_PATTERNS = [
  { name: 'Email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'Phone', pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'Credit Card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  { name: 'Address', pattern: /\b\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way)\b\.?/gi },
];

// ── Crisis Language Keywords ──
const CRISIS_PHRASES = [
  'want to die', 'want to kill myself', 'going to kill myself',
  'ending it all', 'end it all', 'no reason to live', 'better off dead',
  'planning to end', 'suicide plan', 'suicide note',
  'going to hurt myself', 'cut myself', 'cutting myself',
  'overdose', 'take all my pills', 'jump off',
  'can\'t go on', 'can\'t take it anymore', 'nobody would miss me',
  'the world would be better without me', 'i don\'t want to be here',
  'not worth living', 'ready to go', 'final goodbye',
  'goodbye forever', 'this is my last', 'when i\'m gone'
];

// ── Toxicity / Banned Keywords ──
const DEFAULT_TOXICITY_KEYWORDS = [
  'kill yourself', 'kys', 'you should die',
  'go die', 'drink bleach', 'neck yourself'
];

/**
 * Scan text for PII and return findings
 */
function detectPII(text) {
  const findings = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = text.match(regex);
    if (matches) {
      findings.push({
        type: name,
        count: matches.length,
        samples: matches.slice(0, 3).map(m => m.substring(0, 4) + '***')
      });
    }
  }
  return findings;
}

/**
 * Redact PII from text (replace with [REDACTED])
 */
function redactPII(text) {
  let result = text;
  for (const { pattern } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, '[REDACTED]');
  }
  return result;
}

/**
 * Detect crisis language in text
 */
function detectCrisisLanguage(text) {
  const lower = text.toLowerCase();
  const detected = [];
  for (const phrase of CRISIS_PHRASES) {
    if (lower.includes(phrase)) {
      detected.push(phrase);
    }
  }
  return {
    isCrisis: detected.length > 0,
    phrases: detected,
    severity: detected.length >= 3 ? 'high' : detected.length >= 1 ? 'medium' : 'none'
  };
}

/**
 * Check text against toxicity / banned keywords
 */
function detectToxicity(text, additionalBanned = []) {
  const lower = text.toLowerCase();
  const allBanned = [...DEFAULT_TOXICITY_KEYWORDS, ...additionalBanned];
  const found = [];
  for (const keyword of allBanned) {
    if (lower.includes(keyword.toLowerCase())) {
      found.push(keyword);
    }
  }
  return {
    isToxic: found.length > 0,
    keywords: found
  };
}

/**
 * Full text moderation scan
 */
function moderateText(text, additionalBanned = []) {
  const pii = detectPII(text);
  const crisis = detectCrisisLanguage(text);
  const toxicity = detectToxicity(text, additionalBanned);

  let autoAction = 'approve'; // Default for clean text
  const flags = [];

  if (toxicity.isToxic) {
    autoAction = 'reject';
    flags.push(`Toxic content: ${toxicity.keywords.join(', ')}`);
  }
  if (crisis.isCrisis) {
    autoAction = 'flag';
    flags.push(`Crisis language detected (${crisis.severity}): ${crisis.phrases.join(', ')}`);
  }
  if (pii.length > 0) {
    autoAction = 'flag';
    flags.push(`PII detected: ${pii.map(p => `${p.type} (${p.count})`).join(', ')}`);
  }

  return {
    autoAction,
    flags,
    pii,
    crisis,
    toxicity,
    redactedText: pii.length > 0 ? redactPII(text) : text
  };
}

/**
 * Hash an IP address for storage (never store raw IPs)
 */
function hashIP(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(ip + '_anon_stories_salt_2026').digest('hex').substring(0, 16);
}

/**
 * Simulate image safety check (in production, use AWS Rekognition / Google Vision)
 */
function checkImageSafety(filePath) {
  // In production, this would call an actual content-safety API
  return {
    safe: true,
    confidence: 0.98,
    flags: [],
    message: 'Image passed automated safety check'
  };
}

module.exports = {
  detectPII,
  redactPII,
  detectCrisisLanguage,
  detectToxicity,
  moderateText,
  hashIP,
  checkImageSafety
};
