import { describe, expect, it } from 'vitest';
import { stripThinkTags, ThinkTagFilter } from './think-tags';

describe('stripThinkTags', () => {
  it('removes complete think blocks', () => {
    expect(stripThinkTags('<think>internal draft</think>Hello!')).toBe('Hello!');
    expect(stripThinkTags('A<mm:think>x</mm:think>B')).toBe('AB');
  });

  it('drops stray closing tags', () => {
    expect(stripThinkTags("Got it! ✅</mm:think> I'll prepare the workflow.")).toBe(
      "Got it! ✅ I'll prepare the workflow.",
    );
  });

  it('drops unterminated reasoning blocks entirely', () => {
    expect(stripThinkTags('Answer<think>rambling without close')).toBe('Answer');
  });

  it('returns plain text untouched', () => {
    expect(stripThinkTags('Just a normal reply')).toBe('Just a normal reply');
  });
});

describe('ThinkTagFilter', () => {
  it('suppresses tokens inside think blocks across chunk boundaries', () => {
    const filter = new ThinkTagFilter();
    const out = [
      filter.push('Hi '),
      filter.push('<thi'),
      filter.push('nk>secret'),
      filter.push(' plans</thi'),
      filter.push('nk> there'),
      filter.flush(),
    ].join('');
    expect(out).toBe('Hi  there');
  });

  it('drops stray closing tags mid-stream', () => {
    const filter = new ThinkTagFilter();
    const out = [
      filter.push('Got it ✅'),
      filter.push('</mm:think>'),
      filter.push(' ready'),
      filter.flush(),
    ].join('');
    expect(out).toBe('Got it ✅ ready');
  });

  it('emits normal text immediately', () => {
    const filter = new ThinkTagFilter();
    expect(filter.push('plain ')).toBe('plain ');
    expect(filter.push('text')).toBe('text');
    expect(filter.flush()).toBe('');
  });

  it('emits nothing when the stream ends inside a think block', () => {
    const filter = new ThinkTagFilter();
    expect(filter.push('<think>hidden')).toBe('');
    expect(filter.flush()).toBe('');
  });
});
