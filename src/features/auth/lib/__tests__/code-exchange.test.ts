import { describe, expect, jest, test } from '@jest/globals';

import { exchangeAuthCode } from '../code-exchange';

// SPEC-001-T47 / T58: one PKCE exchange per code, shared by reset, verification and OAuth.

jest.mock('@/api/supabase', () => ({
  supabase: { auth: { exchangeCodeForSession: jest.fn() } },
}));

type Fn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const api = jest.requireMock<{ supabase: { auth: Record<string, Fn> } }>('@/api/supabase');

describe('exchangeAuthCode', () => {
  test('concurrent calls for one code make one exchange (SPEC-001-T47, SPEC-001-T58)', async () => {
    api.supabase.auth.exchangeCodeForSession!.mockResolvedValue({ data: {}, error: null });
    const [a, b] = await Promise.all([exchangeAuthCode('c1'), exchangeAuthCode('c1')]);
    expect(api.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ error: null });
    expect(b).toEqual({ error: null });
  });

  test('SDK error or rejection -> link_invalid (SPEC-001-T47)', async () => {
    api.supabase.auth.exchangeCodeForSession!.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid flow state' },
    });
    expect(await exchangeAuthCode('bad-1')).toEqual({ error: 'link_invalid' });

    api.supabase.auth.exchangeCodeForSession!.mockRejectedValueOnce(new Error('offline'));
    expect(await exchangeAuthCode('bad-2')).toEqual({ error: 'link_invalid' });
  });
});
