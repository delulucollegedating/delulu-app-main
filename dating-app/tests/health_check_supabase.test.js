import { describe, expect, it, vi } from 'vitest';

const from = vi.fn(() => ({
  select: vi.fn(() => ({
    limit: vi.fn(async () => ({ data: [{ id: 1 }], error: null }))
  }))
}));

const { checkSupabase } = require('../utils/healthCheck');

describe('Supabase health check', () => {
  it('obtains the client through getSupabase and verifies the messages table', async () => {
    await expect(checkSupabase({ from })).resolves.toEqual({ status: 'ok', message: 'Connected' });
    expect(from).toHaveBeenCalledWith('messages');
  });
});
