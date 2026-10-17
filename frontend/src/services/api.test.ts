import { describe, expect, it } from 'vitest'
import { formatErrorDetail } from './api'

describe('formatErrorDetail', () => {
  it('returns string details unchanged', () => {
    expect(formatErrorDetail('Document not found')).toBe('Document not found')
    expect(formatErrorDetail('')).toBe('')
  })

  it('formats FastAPI validation errors without the leading "body" locator', () => {
    const detail = [
      { loc: ['body', 'rating'], msg: 'value is not a valid integer', type: 'type_error.integer' },
      { loc: ['body', 'time_taken_ms'], msg: 'field required', type: 'value_error.missing' },
    ]
    expect(formatErrorDetail(detail)).toBe(
      'rating: value is not a valid integer; time_taken_ms: field required'
    )
  })

  it('handles single-element locators and non-string messages', () => {
    expect(formatErrorDetail([{ loc: ['body'], msg: 'invalid request' }])).toBe('invalid request')
    expect(formatErrorDetail([{ loc: ['query', 'limit'], msg: 'Input should be a valid integer' }])).toBe(
      'limit: Input should be a valid integer'
    )
  })

  it('falls back to an empty string for empty/missing details like before', () => {
    expect(formatErrorDetail([])).toBe('')
    expect(formatErrorDetail(undefined)).toBe('')
    expect(formatErrorDetail(null)).toBe('')
  })

  it('stringifies unexpected object details instead of showing [object Object]', () => {
    expect(formatErrorDetail({ error: 'quota exceeded' })).toBe('{"error":"quota exceeded"}')
    expect(formatErrorDetail({})).toBe('{}')
  })
})
