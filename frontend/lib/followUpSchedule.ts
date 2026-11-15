/**
 * Next follow-up times shown in the RFQ vendor follow-up modal.
 *
 * Every time counts from the RFQ creation time. SMS and email count elapsed time. AI calls and
 * WhatsApp count only the business window, 10:00 to 18:00 IST, on every day of the week.
 *
 * These are display values. The backend chaser scheduler (backend/src/services/rfqChaserScheduler.js)
 * sets its own timers and does not read this module.
 */
import {
  FOLLOW_UP_BUSINESS_HOURS,
  IST_UTC_OFFSET_MINUTES,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
  RFQ_FOLLOW_UP_DELAY_MINUTES,
  parseRfqTimestamp,
} from './constants';
import type { RFQNextFollowUpTimes } from './types';

const IST_OFFSET_MS = IST_UTC_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;
const BUSINESS_OPEN_MS = FOLLOW_UP_BUSINESS_HOURS.OPEN_MINUTE_OF_DAY * MILLISECONDS_PER_MINUTE;
const BUSINESS_CLOSE_MS = FOLLOW_UP_BUSINESS_HOURS.CLOSE_MINUTE_OF_DAY * MILLISECONDS_PER_MINUTE;
const BUSINESS_WINDOW_MS = BUSINESS_CLOSE_MS - BUSINESS_OPEN_MS;

// The business arithmetic runs on IST wall-clock time, meaning an instant shifted by the IST offset.
// In that form each IST day starts at a multiple of MILLISECONDS_PER_DAY, so no time zone library is needed.

/** Midnight at the start of the IST day that contains `istMs`. */
function istDayStart(istMs: number): number {
  return Math.floor(istMs / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY;
}

/** The first moment at or after `istMs` that falls inside the business window. */
function businessWindowStart(istMs: number): number {
  const dayStart = istDayStart(istMs);
  if (istMs < dayStart + BUSINESS_OPEN_MS) return dayStart + BUSINESS_OPEN_MS;
  if (istMs >= dayStart + BUSINESS_CLOSE_MS) return dayStart + MILLISECONDS_PER_DAY + BUSINESS_OPEN_MS;
  return istMs;
}

/**
 * The instant that comes `minutes` of business time after `startMs`.
 *
 * Time outside 10:00 to 18:00 IST does not count. A start before 10:00 IST counts from 10:00 that day,
 * and a start at or after 18:00 IST counts from 10:00 the next day. A countdown that reaches 18:00
 * before it is used up resumes at 10:00 the next day.
 */
export function addBusinessMinutes(startMs: number, minutes: number): number {
  let cursor = businessWindowStart(startMs + IST_OFFSET_MS);
  let remaining = minutes * MILLISECONDS_PER_MINUTE;
  let available = istDayStart(cursor) + BUSINESS_CLOSE_MS - cursor;
  while (remaining > available) {
    remaining -= available;
    cursor = istDayStart(cursor) + MILLISECONDS_PER_DAY + BUSINESS_OPEN_MS;
    available = BUSINESS_WINDOW_MS;
  }
  return cursor + remaining - IST_OFFSET_MS;
}

function toIsoInstant(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The next follow-up time for each channel, counted from the RFQ creation time.
 * Each value is null when `createdAt` cannot be read.
 */
export function computeRFQFollowUpTimes(createdAt?: string | null): RFQNextFollowUpTimes {
  const createdMs = parseRfqTimestamp(createdAt);
  if (createdMs === null) return { call: null, whatsapp: null, sms: null, email: null };
  return {
    call: toIsoInstant(addBusinessMinutes(createdMs, RFQ_FOLLOW_UP_DELAY_MINUTES.CALL)),
    whatsapp: toIsoInstant(addBusinessMinutes(createdMs, RFQ_FOLLOW_UP_DELAY_MINUTES.WHATSAPP)),
    sms: toIsoInstant(createdMs + RFQ_FOLLOW_UP_DELAY_MINUTES.SMS * MILLISECONDS_PER_MINUTE),
    email: toIsoInstant(createdMs + RFQ_FOLLOW_UP_DELAY_MINUTES.EMAIL * MILLISECONDS_PER_MINUTE),
  };
}
