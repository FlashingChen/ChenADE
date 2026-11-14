export type TokenKind =
  | 'kw'
  | 'str'
  | 'num'
  | 'fn'
  | 'type'
  | 'comment'
  | 'punct'
  | 'text';

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'default',
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'of',
  'in',
  'while',
  'async',
  'await',
  'new',
  'class',
  'extends',
  'implements',
  'interface',
  'type',
  'enum',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'as',
  'try',
  'catch',
  'finally',
  'throw',
  'typeof',
  'void',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'super',
  'switch',
  'case',
  'break',
  'continue',
  'yield',
  'struct',
  'impl',
  'fn',
  'pub',
  'use',
  'mod',
  'mut',
  'match',
  'where',
  'trait',
  'def',
  'self',
  'None',
  'True',
  'False',
  'and',
  'or',
  'not',
  'with',
  'lambda',
  'package',
  'func',
  'defer',
  'go',
  'chan',
  'select',
  'require',
  'end',
]);

const HASH_COMMENT_LANGUAGES = new Set([
  'Python',
  'Shell',
  'YAML',
  'TOML',
  'Ruby',
]);

function isWord(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

export function highlightLine(line: string, language: string): Token[] {
  if (!line) return [{ text: '', kind: 'text' }];

  if (language === 'Markdown') {
    if (/^#{1,6}\s/.test(line)) return [{ text: line, kind: 'kw' }];
    if (/^```/.test(line)) return [{ text: line, kind: 'comment' }];
    if (/^>\s/.test(line)) return [{ text: line, kind: 'comment' }];
    if (/^\s*[-*]\s/.test(line)) {
      const index = line.indexOf(line.trimStart().slice(0, 2));
      return [
        { text: line.slice(0, index + 2), kind: 'punct' },
        { text: line.slice(index + 2), kind: 'text' },
      ];
    }
  }

  const tokens: Token[] = [];
  let index = 0;

  const push = (text: string, kind: TokenKind) => {
    if (text) tokens.push({ text, kind });
  };

  while (index < line.length) {
    const char = line[index];
    const next = line[index + 1] ?? '';

    if (char === '/' && next === '/') {
      push(line.slice(index), 'comment');
      break;
    }

    if (
      char === '#' &&
      (HASH_COMMENT_LANGUAGES.has(language) || language === 'Text') &&
      (index === 0 || /\s/.test(line[index - 1]))
    ) {
      push(line.slice(index), 'comment');
      break;
    }

    if (char === '-' && next === '-' && language === 'SQL') {
      push(line.slice(index), 'comment');
      break;
    }

    if (char === '"' || char === "'" || char === '`') {
      let end = index + 1;
      while (end < line.length && line[end] !== char) {
        if (line[end] === '\\') end += 1;
        end += 1;
      }
      end = Math.min(end + 1, line.length);
      push(line.slice(index, end), 'str');
      index = end;
      continue;
    }

    if (char >= '0' && char <= '9' && (index === 0 || !isWord(line[index - 1]))) {
      let end = index;
      while (end < line.length && /[0-9a-fA-FxX._]/.test(line[end])) end += 1;
      push(line.slice(index, end), 'num');
      index = end;
      continue;
    }

    if (isWord(char)) {
      let end = index;
      while (end < line.length && isWord(line[end])) end += 1;
      const word = line.slice(index, end);
      const rest = line.slice(end).trimStart();

      if (KEYWORDS.has(word)) {
        push(word, 'kw');
      } else if (/^[A-Z]/.test(word)) {
        push(word, 'type');
      } else if (rest.startsWith('(') || rest.startsWith('= (')) {
        push(word, 'fn');
      } else {
        push(word, 'text');
      }
      index = end;
      continue;
    }

    let end = index + 1;
    while (
      end < line.length &&
      !isWord(line[end]) &&
      !/[ "'`]/.test(line[end]) &&
      !(line[end] === '/' && line[end + 1] === '/')
    ) {
      end += 1;
    }
    push(line.slice(index, end), 'punct');
    index = end;
  }

  return tokens.length > 0 ? tokens : [{ text: line, kind: 'text' }];
}
