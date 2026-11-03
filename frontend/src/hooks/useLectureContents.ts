import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { lecturesApi } from '@/services/api'
import { queryKeys } from '@/lib/constants'

const SEPARATOR = '\u0000'

/** Full text of the selected lectures, for the wizards' cost estimate. */
export function useLectureContents(lectureIds: number[]): string[] {
  // combine to one string: a primitive keeps the memo below stable
  const joined = useQueries({
    queries: lectureIds.map((id) => ({
      queryKey: queryKeys.lecture(id),
      queryFn: () => lecturesApi.get(id),
    })),
    combine: (results) => results.map((r) => r.data?.content ?? '').join(SEPARATOR),
  })
  return useMemo(() => (lectureIds.length > 0 ? joined.split(SEPARATOR) : []), [joined, lectureIds.length])
}
