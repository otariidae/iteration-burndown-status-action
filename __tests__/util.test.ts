import { LocalDate } from '@js-joda/core'
import { describe, expect, it } from 'vitest'
import { durationInBusinessDays } from '../src/util'

describe('durationInBusinessDays', () => {
  it('returns difference in business days', () => {
    const startDate = LocalDate.of(2020, 6, 1)
    const endDate = LocalDate.of(2020, 6, 2)
    expect(durationInBusinessDays(startDate, endDate)).toBe(2)
  })
  describe('startDate is same as endDate', () => {
    it('returns 1', () => {
      const startDate = LocalDate.of(2020, 6, 1)
      const endDate = startDate
      expect(durationInBusinessDays(startDate, endDate)).toBe(1)
    })
  })
  describe('when date range includes a weekend', () => {
    it('returns difference in business days excluding weekends', () => {
      const startDate = LocalDate.of(1999, 12, 31) // Friday
      const endDate = LocalDate.of(2000, 1, 6) // Thursday
      expect(durationInBusinessDays(startDate, endDate)).toBe(5)
    })
  })
  describe('when startDate is a weekend', () => {
    it('returns difference in business days excluding weekends', () => {
      const startDate = LocalDate.of(2000, 1, 1) // Saturday
      const endDate = LocalDate.of(2000, 1, 3) // Thursday
      expect(durationInBusinessDays(startDate, endDate)).toBe(1)
    })
  })
  describe('when endDate is a weekend', () => {
    it('returns difference in business days excluding weekends', () => {
      const startDate = LocalDate.of(1999, 12, 31) // Friday
      const endDate = LocalDate.of(2000, 1, 2) // Sunday
      expect(durationInBusinessDays(startDate, endDate)).toBe(1)
    })
  })
  describe('when startDate is after endDate', () => {
    it('returns 0', () => {
      const startDate = LocalDate.of(1999, 12, 31)
      const endDate = LocalDate.of(1999, 12, 30)
      expect(durationInBusinessDays(startDate, endDate)).toBe(0)
    })
  })
  describe('startDate is Saturday and endDate is Sunday', () => {
    it('returns 0', () => {
      const startDate = LocalDate.of(2000, 1, 1)
      const endDate = LocalDate.of(2000, 1, 2)
      expect(durationInBusinessDays(startDate, endDate)).toBe(0)
    })
  })
})
