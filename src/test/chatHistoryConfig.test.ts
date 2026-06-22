import { describe, it, expect } from 'vitest';
import {
  CHAT_HISTORY_LIMITS_BY_PLAN,
  getChatHistoryLimitForPlan,
  trimChatHistoryForPlan,
} from '@/lib/chatHistoryConfig';

function makeMessages(n: number, role: 'user' | 'assistant' = 'user') {
  return Array.from({ length: n }, (_, i) => ({ role, content: `m${i}` }));
}

describe('getChatHistoryLimitForPlan', () => {
  it('free => 2 turns / 4 messages', () => {
    expect(getChatHistoryLimitForPlan('free')).toEqual({ plan: 'free', turns: 2, messages: 4 });
  });
  it('basic => 5 turns / 10 messages', () => {
    expect(getChatHistoryLimitForPlan('basic')).toEqual({ plan: 'basic', turns: 5, messages: 10 });
  });
  it('premium => 10 turns / 20 messages', () => {
    expect(getChatHistoryLimitForPlan('premium')).toEqual({ plan: 'premium', turns: 10, messages: 20 });
  });
  it('enterprise => 10 turns / 20 messages', () => {
    expect(getChatHistoryLimitForPlan('enterprise')).toEqual({ plan: 'enterprise', turns: 10, messages: 20 });
  });
  it('unknown / null / undefined => free fallback', () => {
    expect(getChatHistoryLimitForPlan(null)).toEqual({ plan: 'free', turns: 2, messages: 4 });
    expect(getChatHistoryLimitForPlan(undefined)).toEqual({ plan: 'free', turns: 2, messages: 4 });
    expect(getChatHistoryLimitForPlan('mystery-plan')).toEqual({ plan: 'free', turns: 2, messages: 4 });
  });
  it('exposes the static map for reference', () => {
    expect(CHAT_HISTORY_LIMITS_BY_PLAN.free.messages).toBe(4);
    expect(CHAT_HISTORY_LIMITS_BY_PLAN.premium.messages).toBe(20);
  });
});

describe('trimChatHistoryForPlan', () => {
  const interleaved = [
    { role: 'user', content: 'u0' },
    { role: 'assistant', content: 'a0' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
    { role: 'assistant', content: 'a3' },
    { role: 'user', content: 'u4' },
    { role: 'assistant', content: 'a4' },
    { role: 'user', content: 'u5' },
    { role: 'assistant', content: 'a5' },
  ];

  it('free keeps the last 4 messages', () => {
    const out = trimChatHistoryForPlan(interleaved, 'free');
    expect(out).toHaveLength(4);
    expect(out.map(m => m.content)).toEqual(['u4', 'a4', 'u5', 'a5']);
  });

  it('basic keeps the last 10 messages', () => {
    const out = trimChatHistoryForPlan(interleaved, 'basic');
    expect(out).toHaveLength(10);
    expect(out[0].content).toBe('u1');
    expect(out[out.length - 1].content).toBe('a5');
  });

  it('premium keeps the last 20 messages (all 12 here)', () => {
    const out = trimChatHistoryForPlan(interleaved, 'premium');
    expect(out).toHaveLength(12);
  });

  it('enterprise keeps the last 20 messages (all 12 here)', () => {
    const out = trimChatHistoryForPlan(interleaved, 'enterprise');
    expect(out).toHaveLength(12);
  });

  it('unknown plan falls back to free (4 messages)', () => {
    const out = trimChatHistoryForPlan(interleaved, 'mystery');
    expect(out).toHaveLength(4);
  });

  it('filters out non user/assistant roles', () => {
    const mixed = [
      { role: 'system', content: 's0' },
      { role: 'tool', content: 't0' },
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'a0' },
    ];
    const out = trimChatHistoryForPlan(mixed, 'premium');
    expect(out.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('returns all messages when fewer than the limit', () => {
    const few = makeMessages(3, 'user');
    expect(trimChatHistoryForPlan(few, 'basic')).toHaveLength(3);
  });

  it('preserves the current user prompt when included in the input', () => {
    const withCurrent = [
      ...interleaved,
      { role: 'user', content: 'CURRENT_PROMPT' },
    ];
    const out = trimChatHistoryForPlan(withCurrent, 'free');
    expect(out[out.length - 1].content).toBe('CURRENT_PROMPT');
  });
});
