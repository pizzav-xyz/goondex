import { beforeEach, describe, expect, it } from 'vitest'
import { DEV_TTL, clearWithTtl, readWithTtl, writeWithTtl } from '@/constants/dev'

const VALUE = 'dev_value'
const TS = 'dev_value_ts'

beforeEach(() => {
  localStorage.clear()
})

describe('writeWithTtl / readWithTtl', () => {
  it('round-trips a value written in this build', () => {
    writeWithTtl(VALUE, TS, { tags: 'canine', ratings: ['s'] })
    expect(readWithTtl<{ tags: string }>(VALUE, TS)).toEqual({
      tags: 'canine',
      ratings: ['s'],
    })
  })

  it('returns null and clears both keys when the timestamp is missing', () => {
    localStorage.setItem(VALUE, JSON.stringify({ a: 1 }))
    expect(readWithTtl(VALUE, TS)).toBeNull()
    expect(localStorage.getItem(VALUE)).toBeNull()
  })

  it('returns null and clears both keys once the TTL has passed', () => {
    writeWithTtl(VALUE, TS, { a: 1 })
    localStorage.setItem(TS, String(Date.now() - DEV_TTL - 1))
    expect(readWithTtl(VALUE, TS)).toBeNull()
    expect(localStorage.getItem(VALUE)).toBeNull()
    expect(localStorage.getItem(TS)).toBeNull()
  })

  it('keeps a value that is still inside the TTL', () => {
    writeWithTtl(VALUE, TS, { a: 1 })
    localStorage.setItem(TS, String(Date.now() - DEV_TTL + 60_000))
    expect(readWithTtl<{ a: number }>(VALUE, TS)).toEqual({ a: 1 })
  })

  it('returns null for a corrupt value instead of throwing', () => {
    localStorage.setItem(VALUE, '{not json')
    localStorage.setItem(TS, String(Date.now()))
    expect(readWithTtl(VALUE, TS)).toBeNull()
  })
})

describe('clearWithTtl', () => {
  it('removes both keys', () => {
    writeWithTtl(VALUE, TS, { a: 1 })
    clearWithTtl(VALUE, TS)
    expect(localStorage.getItem(VALUE)).toBeNull()
    expect(localStorage.getItem(TS)).toBeNull()
  })
})