export function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'ts':
      return 'TypeScript';
    case 'tsx':
      return 'TypeScript React';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'JavaScript';
    case 'jsx':
      return 'JavaScript React';
    case 'json':
      return 'JSON';
    case 'css':
      return 'CSS';
    case 'md':
      return 'Markdown';
    case 'rs':
      return 'Rust';
    case 'py':
      return 'Python';
    case 'go':
      return 'Go';
    case 'swift':
      return 'Swift';
    case 'sh':
    case 'zsh':
      return 'Shell';
    case 'yml':
    case 'yaml':
      return 'YAML';
    default:
      return 'Text';
  }
}
