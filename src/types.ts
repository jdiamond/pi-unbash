/** A command extracted from the AST with its name and arguments. */
export interface ExtractedCommand {
  name: string;
  args: string[];
  /** Source positions of each argument token, for display with original quoting. */
  argRanges?: Array<{ pos: number; end: number }>;
  /** Heredoc redirects attached to this command, for display. */
  heredocs?: Array<{ operator: string; marker: string; quoted: boolean; content: string }>;
  /** Non-heredoc redirects attached to this command, for display (e.g. 2>&1, >out.txt). */
  otherRedirects?: Array<{ text: string }>;
  pos?: number;
  end?: number;
}
