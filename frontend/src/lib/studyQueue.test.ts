import { describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { queryKeys, studyQueueQueryOptions } from './constants'

describe('active study queue', () => {
  it('keeps the original card positions on focus/reconnect and reloads for a new session', async () => {
    const client = new QueryClient()
    let remaining = [1, 2, 3]
    let calls = 0
    const queryFn = async () => { calls++; return [...remaining] }
    const key = queryKeys.studyQueue('1', 1)
    const observer = new QueryObserver(client, { ...studyQueueQueryOptions, queryKey: key, queryFn })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await observer.refetch()
      remaining = [3] // Two cards have now been rated on the server.
      client.setQueryData(key, [1, 2, 3], { updatedAt: Date.now() - 600_000 })
      const query = client.getQueryCache().find({ queryKey: key })!
      query.onFocus()
      query.onOnline()
      await Promise.resolve()
      expect(calls).toBe(1)
      expect(observer.getCurrentResult().data?.[2]).toBe(3)
      const next = await client.fetchQuery({ ...studyQueueQueryOptions, queryKey: queryKeys.studyQueue('1', 2), queryFn })
      expect(next).toEqual([3])
    } finally {
      unsubscribe()
      client.clear()
    }
  })
})
