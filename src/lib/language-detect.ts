import path from 'node:path';

/**
 * Maps common source-file extensions to their language name.
 * Used by load_file for language detection.
 */
export const EXTENSION_LANGUAGE_MAP: ReadonlyMap<string, string> = new Map([
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.py', 'Python'],
  ['.rb', 'Ruby'],
  ['.go', 'Go'],
  ['.rs', 'Rust'],
  ['.java', 'Java'],
  ['.kt', 'Kotlin'],
  ['.cs', 'C#'],
  ['.c', 'C'],
  ['.cpp', 'C++'],
  ['.h', 'C'],
  ['.hpp', 'C++'],
  ['.swift', 'Swift'],
  ['.php', 'PHP'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.zsh', 'Shell'],
  ['.json', 'JSON'],
  ['.yaml', 'YAML'],
  ['.yml', 'YAML'],
  ['.toml', 'TOML'],
  ['.xml', 'XML'],
  ['.html', 'HTML'],
  ['.css', 'CSS'],
  ['.scss', 'SCSS'],
  ['.sql', 'SQL'],
  ['.md', 'Markdown'],
  ['.lua', 'Lua'],
  ['.r', 'R'],
  ['.dart', 'Dart'],
  ['.ex', 'Elixir'],
  ['.exs', 'Elixir'],
  ['.erl', 'Erlang'],
  ['.zig', 'Zig'],
  ['.vue', 'Vue'],
  ['.svelte', 'Svelte'],
  ['.astro', 'Astro'],
  ['.graphql', 'GraphQL'],
  ['.proto', 'Protocol Buffers'],
  ['.ps1', 'PowerShell'],
]);

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP.get(ext) ?? 'Unknown';
}
