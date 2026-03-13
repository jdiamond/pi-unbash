export const DEFAULT_ALWAYS_ALLOWED: string[] = [
  // Basic read-only utilities
  "cat", "cd", "echo", "find", "grep", "head", "ls", "pwd", "rg", "sort", "tail", "true", "uniq", "wc",
  // Path utilities
  "basename", "dirname", "realpath",
  // System info
  "date", "file", "stat", "uname", "whoami",
  // Tool discovery
  "type", "which",
  // Read-only git
  "git blame", "git branch --show-current", "git diff", "git log", "git show", "git status",
];
