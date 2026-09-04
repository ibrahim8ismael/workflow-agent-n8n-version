/**
 * Reasoning-model output hygiene: some providers (e.g. reasoning models on
 * Groq) leak `<think>…</think>`-style markers into chat text. These helpers
 * strip them from complete responses and from streamed token chunks without
 * breaking tags across chunk boundaries.
 */

const OPEN_TAGS = ['<think>', '<mm:think>', '<reasoning>'];
const CLOSE_TAGS = ['</think>', '</mm:think>', '</reasoning>'];

const OPEN_RE = /<(think|mm:think|reasoning)\s*>/i;
const CLOSE_RE = /<\/(think|mm:think|reasoning)\s*>/i;

/** Strips reasoning blocks/stray tags from a COMPLETE text. */
export function stripThinkTags(text: string): string {
  if (!text) return text;
  let out = '';
  let rest = text;
  let inside = false;
  while (rest.length > 0) {
    if (!inside) {
      const open = OPEN_RE.exec(rest);
      const close = CLOSE_RE.exec(rest);
      if (open && (!close || open.index < close.index)) {
        out += rest.slice(0, open.index);
        rest = rest.slice(open.index + open[0].length);
        inside = true;
        continue;
      }
      if (close) {
        // Stray close tag with no matching open — drop the tag only.
        out += rest.slice(0, close.index);
        rest = rest.slice(close.index + close[0].length);
        continue;
      }
      out += rest;
      break;
    }
    const close = CLOSE_RE.exec(rest);
    if (!close) {
      break; // unterminated reasoning block — drop the remainder
    }
    rest = rest.slice(close.index + close[0].length);
    inside = false;
  }
  return out;
}

function isPartialTagPrefix(tail: string): boolean {
  const candidates = [...OPEN_TAGS, ...CLOSE_TAGS];
  return candidates.some(
    (tag) => tag.toLowerCase().startsWith(tail.toLowerCase()) && tail.length > 0,
  );
}

/**
 * Stateful chunk filter for token streams. Push each raw chunk; it returns
 * the safe text to emit. Call `flush()` after the stream ends.
 */
export class ThinkTagFilter {
  private inside = false;
  private buffer = '';

  push(chunk: string): string {
    if (!chunk) return '';
    this.buffer += chunk;
    let out = '';
    for (;;) {
      if (!this.inside) {
        const open = OPEN_RE.exec(this.buffer);
        const close = CLOSE_RE.exec(this.buffer);
        if (open && (!close || open.index < close.index)) {
          out += this.buffer.slice(0, open.index);
          this.buffer = this.buffer.slice(open.index + open[0].length);
          this.inside = true;
          continue;
        }
        if (close) {
          // Stray close tag — drop the tag, keep surrounding text.
          out += this.buffer.slice(0, close.index);
          this.buffer = this.buffer.slice(close.index + close[0].length);
          continue;
        }
        // Hold back a tail that could be the start of a tag split across chunks.
        const hold = this.holdLength();
        out += this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        return out;
      }
      const close = CLOSE_RE.exec(this.buffer);
      if (!close) {
        // Swallow reasoning content until a close tag appears.
        this.buffer = this.buffer.slice(-15); // keep a partial-close prefix window
        return out;
      }
      this.buffer = this.buffer.slice(close.index + close[0].length);
      this.inside = false;
    }
  }

  flush(): string {
    if (this.inside) {
      this.buffer = '';
      return '';
    }
    const rest = this.buffer;
    this.buffer = '';
    return rest;
  }

  private holdLength(): number {
    for (let len = Math.min(this.buffer.length, 15); len > 0; len--) {
      if (isPartialTagPrefix(this.buffer.slice(-len))) return len;
    }
    return 0;
  }
}
