import holiday from '@holiday-jp/holiday_jp'
import { type LocalDate, convert } from '@js-joda/core'

function isWeekendOrHoliday(date: LocalDate): boolean {
  return (
    date.dayOfWeek().value() > 5 || holiday.isHoliday(convert(date).toDate())
  )
}

export function durationInBusinessDays(
  startDate: LocalDate,
  endDate: LocalDate
): number {
  let businessDays = 0
  for (
    let date = startDate;
    date.isBefore(endDate) || date.isEqual(endDate);
    date = date.plusDays(1)
  ) {
    if (isWeekendOrHoliday(date)) {
      continue
    }
    businessDays++
  }
  return businessDays
}
