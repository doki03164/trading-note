import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRemoteHub, disconnectRemoteHub, normalizeRemoteHubUrl, refreshRemoteHub } from './remoteSync';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});
afterEach(() => { disconnectRemoteHub(true); localStorage.clear(); vi.unstubAllGlobals(); });

describe('remote desktop sync', () => {
  it('accepts HTTPS tunnels and local HTTP only', () => {
    expect(normalizeRemoteHubUrl('https://sync.example.test/')).toBe('https://sync.example.test');
    expect(normalizeRemoteHubUrl('http://127.0.0.1:45831/')).toBe('http://127.0.0.1:45831');
    expect(() => normalizeRemoteHubUrl('http://sync.example.test')).toThrow('HTTPS');
  });

  it('authenticates each refresh with the pairing token', async () => {
    const snapshot = { positions: [], futuresBalance: null };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: '0.3.1', generatedAt: 1, snapshot, history: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const token = '01234567890123456789012345678901';
    await connectRemoteHub('https://hub.example.test', token);
    await refreshRemoteHub();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${token}`);
  });
});
