import type { Command } from "unbash";

/** A concrete command node together with the source string its positions refer to. */
export interface CommandRef {
  node: Command;
  source: string;
}
