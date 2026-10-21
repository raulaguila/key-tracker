const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

function validResultName(value) { return typeof value === 'string' && IDENTIFIER.test(value) && !FORBIDDEN.has(value); }

function parseResultPath(value) {
  if (typeof value !== 'string' || value.length > 320) throw new Error('Referência de resultado inválida.');
  const parts = value.split('.');
  if (parts[0] !== 'steps' || !validResultName(parts[1]) || !['status', 'body', 'json'].includes(parts[2]) ||
      (parts[2] !== 'json' && parts.length !== 3) || (parts[2] === 'json' && (parts.length < 4 || parts.length > 11)) ||
      parts.slice(3).some(part => (!IDENTIFIER.test(part) && !/^(0|[1-9][0-9]{0,5})$/.test(part)) || FORBIDDEN.has(part))) {
    throw new Error('Referência de resultado inválida. Use steps.nome.status, body ou json.campo.');
  }
  return parts;
}

function resultReferences(value) {
  const paths = new Set();
  const visit = item => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/\{\{(steps\.[^{}]*)\}\}/g)) { parseResultPath(match[1]); paths.add(match[1]); }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return [...paths];
}

function resultValue(results, path) {
  const parts = parseResultPath(path);
  let value = results;
  for (const part of parts.slice(1)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function scalarText(value) { return typeof value === 'string' ? value : JSON.stringify(value); }

function resolveResultTemplates(value, results) {
  const pieces = [];
  let offset = 0, size = 0;
  for (const match of value.matchAll(/\{\{(steps\.[^{}]*)\}\}/g)) {
    const found = resultValue(results, match[1]);
    if (found === undefined) throw new Error('Resultado anterior indisponível para esta etapa.');
    const prefix = value.slice(offset, match.index);
    const replacement = scalarText(found);
    size += prefix.length + replacement.length;
    if (size > 64000) throw new Error('Conteúdo dinâmico excedeu o limite da etapa.');
    pieces.push(prefix, replacement);
    offset = match.index + match[0].length;
  }
  if (size + value.length - offset > 64000) throw new Error('Conteúdo dinâmico excedeu o limite da etapa.');
  pieces.push(value.slice(offset));
  return pieces.join('');
}

function conditionMatches(condition, results) {
  if (!condition) return true;
  const value = resultValue(results, condition.path);
  if (condition.operator === 'exists') return value !== undefined;
  const expected = resolveResultTemplates(condition.value, results);
  if (condition.operator === 'equals') return value !== undefined && scalarText(value) === expected;
  if (condition.operator === 'notEquals') return value === undefined || scalarText(value) !== expected;
  return value !== undefined && scalarText(value).includes(expected);
}

module.exports = { validResultName, parseResultPath, resultReferences, resultValue, resolveResultTemplates, conditionMatches };
