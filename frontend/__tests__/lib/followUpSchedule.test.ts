import { addBusinessMinutes, computeRFQFollowUpTimes } from '@/lib/followUpSchedule';

/** The ISO instant for a wall-clock time in India, e.g. istInstant('2026-11-11T12:40'). */
const istInstant = (local: string): string => new Date(Date.parse(`${local}:00+05:30`)).toISOString();

describe('computeRFQFollowUpTimes', () => {
  it('counts SMS and email from the creation time, with no business-hours limit', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T19:30'));
    expect(times.sms).toBe(istInstant('2026-11-11T19:35'));
    expect(times.email).toBe(istInstant('2026-11-12T19:30'));
  });

  it('counts the AI call and WhatsApp inside business hours when the RFQ is created inside them', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T12:40'));
    // 5h20m remain before 18:00, so the 6-hour call needs 40 more minutes on the next day.
    expect(times.call).toBe(istInstant('2026-11-12T10:40'));
    // 5h20m remain on the 11th, so 6h40m of the 12-hour WhatsApp countdown falls on the 12th.
    expect(times.whatsapp).toBe(istInstant('2026-11-12T16:40'));
  });

  it('starts the countdown at 10:00 the same day when the RFQ is created before 10:00', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T09:15'));
    expect(times.call).toBe(istInstant('2026-11-11T16:00'));
    // The 12-hour WhatsApp countdown uses all 8 business hours on the 11th, then 4 hours on the 12th.
    expect(times.whatsapp).toBe(istInstant('2026-11-12T14:00'));
    expect(times.sms).toBe(istInstant('2026-11-11T09:20'));
    expect(times.email).toBe(istInstant('2026-11-12T09:15'));
  });

  it('starts the countdown at 10:00 the same day when the RFQ is created exactly at 10:00', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T10:00'));
    expect(times.call).toBe(istInstant('2026-11-11T16:00'));
    expect(times.whatsapp).toBe(istInstant('2026-11-12T14:00'));
  });

  it('carries the countdown into the next day when the window closes first', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T14:00'));
    // 4 hours fit before 18:00, so the 6-hour call has 2 hours left: 12:00 on the next day.
    expect(times.call).toBe(istInstant('2026-11-12T12:00'));
    // 4 hours fit before 18:00 and 8 hours remain, which is exactly one full window: 18:00 on the next day.
    expect(times.whatsapp).toBe(istInstant('2026-11-12T18:00'));
  });

  it('starts the countdown at 10:00 the next day when the RFQ is created after 18:00', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T19:30'));
    expect(times.call).toBe(istInstant('2026-11-12T16:00'));
    expect(times.whatsapp).toBe(istInstant('2026-11-13T14:00'));
  });

  it('treats exactly 18:00 as after the window closes', () => {
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T18:00'));
    expect(times.call).toBe(istInstant('2026-11-12T16:00'));
    expect(times.whatsapp).toBe(istInstant('2026-11-13T14:00'));
  });

  it('keeps counting across several days when little of the window is left', () => {
    // One minute of business time remains on the 11th, so the 6-hour call needs 359 more minutes on the 12th.
    const times = computeRFQFollowUpTimes(istInstant('2026-11-11T17:59'));
    expect(times.call).toBe(istInstant('2026-11-12T15:59'));
    // The 12-hour WhatsApp countdown needs 719 more minutes: 480 on the 12th, then 239 on the 13th.
    expect(times.whatsapp).toBe(istInstant('2026-11-13T13:59'));
  });

  it('counts Saturday and Sunday as business days, since the window applies every day', () => {
    // 14 Nov 2026 is a Saturday and 15 Nov 2026 is a Sunday.
    const times = computeRFQFollowUpTimes(istInstant('2026-11-14T11:00'));
    expect(times.call).toBe(istInstant('2026-11-14T17:00'));
    // 7 hours fit on the 14th. The remaining 5 hours fall on the 15th, from 10:00 to 15:00.
    expect(times.whatsapp).toBe(istInstant('2026-11-15T15:00'));
  });

  it('reads a zone-less MySQL timestamp as UTC', () => {
    // 07:10 UTC is 12:40 IST, the same moment as the creation time in the first business-hours case.
    expect(computeRFQFollowUpTimes('2026-11-11 07:10:00').call).toBe(istInstant('2026-11-12T10:40'));
  });

  it('reads a date-only creation date as midnight UTC, which is 05:30 IST', () => {
    const times = computeRFQFollowUpTimes('2026-08-29');
    // 05:30 IST is before the window opens, so the countdown starts at 10:00 that day.
    expect(times.call).toBe(istInstant('2026-08-29T16:00'));
    expect(times.whatsapp).toBe(istInstant('2026-08-30T14:00'));
    expect(times.sms).toBe(istInstant('2026-08-29T05:35'));
    expect(times.email).toBe(istInstant('2026-08-30T05:30'));
  });

  it.each([[undefined], [null], [''], ['not a date']])('returns no time for an unreadable creation value %p', (createdAt) => {
    expect(computeRFQFollowUpTimes(createdAt)).toEqual({ call: null, whatsapp: null, sms: null, email: null });
  });
});

describe('addBusinessMinutes', () => {
  it('returns the same instant for zero minutes inside the window', () => {
    const start = Date.parse('2026-11-11T12:40:00+05:30');
    expect(addBusinessMinutes(start, 0)).toBe(start);
  });

  it('moves a zero-minute start before the window up to 10:00 that day', () => {
    expect(addBusinessMinutes(Date.parse('2026-11-11T08:00:00+05:30'), 0)).toBe(Date.parse('2026-11-11T10:00:00+05:30'));
  });

  it('moves a zero-minute start after the window up to 10:00 the next day', () => {
    expect(addBusinessMinutes(Date.parse('2026-11-11T18:30:00+05:30'), 0)).toBe(Date.parse('2026-11-12T10:00:00+05:30'));
  });
});
