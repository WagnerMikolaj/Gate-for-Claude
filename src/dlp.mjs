// Deterministic baseline, NOT a semantic guarantee. No prompt leaves this process for classification.
export function normalize(text) {
  return text.normalize('NFKC').replace(/[\p{Cf}\u034f\uFE00-\uFE0F]/gu, '');
}
function luhn(digits) {
  let sum = 0;
  for (let i = digits.length - 1, alternate = false; i >= 0; i--, alternate = !alternate) {
    let n = Number(digits[i]);
    if (alternate && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0 && !/^(\d)\1+$/.test(digits);
}
function mod97(s) {
  let remainder = 0;
  for (const ch of s) {
    const part = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const n of part) remainder = (remainder * 10 + Number(n)) % 97;
  }
  return remainder;
}
function pesel(s) {
  const sum = [...s.slice(0, 10)].reduce((v, n, i) => v + Number(n) * [1,3,7,9,1,3,7,9,1,3][i], 0);
  return (10 - sum % 10) % 10 === Number(s[10]) && !/^(\d)\1+$/.test(s);
}
export function inspect(text, policy) {
  const value = normalize(text);
  const lower = value.toLocaleLowerCase('pl');
  const categories = new Set();
  if (policy.blockedTerms.some(term => lower.includes(normalize(term).toLocaleLowerCase('pl')))) categories.add('CONFIDENTIAL_LABEL');
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) categories.add('EMAIL');
  if (/(?:\+\d{1,3}[ .-]?)?(?:\d[ .-]?){9,15}/.test(value)) categories.add('PERSONAL_NUMBER');
  for (const m of value.matchAll(/(?<!\d)\d{11}(?!\d)/g)) if (pesel(m[0])) categories.add('PESEL');
  for (const m of value.matchAll(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g)) if (luhn(m[0].replace(/\D/g, ''))) categories.add('PAYMENT_CARD');
  for (const m of value.toUpperCase().matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g)) {
    const iban = m[0].replace(/ /g, '');
    if (iban.length <= 34 && mod97(iban.slice(4) + iban.slice(0,4)) === 1) categories.add('IBAN');
  }
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-ant-[a-z0-9_-]{12,}|sk-[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[a-z0-9]{20,})\b/i.test(value) || /\b(?:password|passwd|hasło|haslo|api[_ -]?key|client[_ -]?secret|access[_ -]?token|authorization)\s*[:=]\s*\S{4,}/i.test(value)) categories.add('SECRET');
  // Opaque encodings cannot be reliably inspected; reject common long encodings conservatively.
  if (/[A-Za-z0-9+/]{80,}={0,2}|(?:%[0-9a-f]{2}){12,}|(?:\\u[0-9a-f]{4}){8,}/i.test(value)) categories.add('OPAQUE_ENCODING');
  return { allowed: categories.size === 0, categories: [...categories].sort() };
}
export function validateMessages(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) throw new Error('INVALID_MESSAGES');
  let total = 0;
  const messages = body.messages.map((m, i) => {
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).sort().join(',') !== 'content,role' || m.role !== (i % 2 === 0 ? 'user' : 'assistant') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000) throw new Error('INVALID_MESSAGES');
    total += Buffer.byteLength(m.content);
    return { role: m.role, content: m.content };
  });
  if (messages.at(-1).role !== 'user' || total > 48000) throw new Error('INVALID_MESSAGES');
  return messages;
}
export function inspectMessages(messages, policy) {
  const categories = new Set(messages.flatMap(m => inspect(m.content, policy).categories));
  // Also scan across message boundaries so splitting a secret between messages is blocked.
  for (const separator of ['', '\n']) for (const category of inspect(messages.map(m => m.content).join(separator), policy).categories) categories.add(category);
  return { allowed: categories.size === 0, categories: [...categories].sort() };
}
