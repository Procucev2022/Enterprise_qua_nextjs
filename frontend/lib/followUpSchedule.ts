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
import type {
  RFQFollowUpMetrics,
  RFQItem,
  RFQNextFollowUpTimes,
  VendorChannelEmail,
  VendorFollowUpRecord,
} from './types';
import { UI_STRINGS } from './uiStrings';

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

const NOT_DISPATCHED_CHANNEL = { status: 'not_dispatched' as const, lastAttempt: '' };

function readEmailChannelStatus(vendor: VendorFollowUpRecord): string {
  const rec = vendor as VendorFollowUpRecord & { email?: string | VendorChannelEmail };
  if (rec.email && typeof rec.email === 'object' && rec.email.status) {
    return rec.email.status;
  }
  return '';
}

function isEmailEscalationDispatched(vendor: VendorFollowUpRecord): boolean {
  const email24hStatus = vendor.email24h?.status || '';
  const rawEmailStatus = readEmailChannelStatus(vendor);
  return Boolean(
    vendor.email24h?.is24hReminderSent ||
    email24hStatus === 'sent' ||
    email24hStatus === 'delivered' ||
    email24hStatus === 'reminded_24h' ||
    rawEmailStatus === 'sent' ||
    rawEmailStatus === 'delivered'
  );
}

/**
 * Normalizes `rfq.followUpData.vendors` (or falls back to `rfq.assignedVendors` when no
 * vendor telemetry array was initialized) so rows always carry vendorId, vendorName, and status fields.
 */
export function normalizeFollowUpVendors(
  rfq: Pick<RFQItem, 'followUpData' | 'assignedVendors'>,
  notRecordedLabel: string = UI_STRINGS.recordPlaceholders.notRecorded
): VendorFollowUpRecord[] {
  const followUp = rfq.followUpData;
  const rawVendors: VendorFollowUpRecord[] = followUp?.vendors
    ? followUp.vendors
    : (rfq.assignedVendors || []).map((av, idx) => ({
        vendorId: av.id || `v-${idx + 1}`,
        vendorName: av.name || notRecordedLabel,
        contactPerson: av.contactPerson || '',
        phone: av.phone || '',
        overallStatus: 'Pending' as const,
        lastInteraction: '',
        bidStatus: 'Pending' as const,
        call: NOT_DISPATCHED_CHANNEL,
        whatsapp: NOT_DISPATCHED_CHANNEL,
        sms: NOT_DISPATCHED_CHANNEL,
      }));

  return rawVendors.map((v, idx) => {
    const bidStatus = v.bidStatus || 'Pending';
    const overallStatus = v.overallStatus || (bidStatus === 'Submitted' ? 'Responded' : 'Pending');
    const resolvedName = v.vendorName || v.name || notRecordedLabel;
    const resolvedId = v.vendorId || v.id || `v-${idx + 1}`;
    const fallbackEmailChannel =
      !v.email24h && v.email && typeof v.email === 'object' ? v.email : v.email24h;
    return {
      ...v,
      vendorId: resolvedId,
      vendorName: resolvedName,
      bidStatus,
      overallStatus,
      call: v.call || NOT_DISPATCHED_CHANNEL,
      whatsapp: v.whatsapp || NOT_DISPATCHED_CHANNEL,
      sms: v.sms || NOT_DISPATCHED_CHANNEL,
      email24h: fallbackEmailChannel,
    };
  });
}

/**
 * Computes consistent follow-up counts for an RFQ by reconciling summary counters with
 * per-vendor dispatch telemetry and submitted quotes (preserving undefined when followUpData is absent).
 */
export function computeRFQFollowUpMetrics(
  rfq: Pick<RFQItem, 'followUpData' | 'assignedVendors' | 'procucevVendorCount' | 'quotesCount' | 'quotes'>
): RFQFollowUpMetrics {
  const followUp = rfq.followUpData;
  const hasFollowUp = Boolean(followUp);
  const vendors = Array.isArray(followUp?.vendors) ? followUp.vendors : [];

  const vendorCallConnected = vendors.filter(
    (v) => v?.call?.status === 'connected' || v?.call?.status === 'completed'
  ).length;
  const vendorWaRead = vendors.filter(
    (v) => v?.whatsapp?.status === 'read' || v?.whatsapp?.status === 'replied'
  ).length;
  const vendorWaDelivered = vendors.filter((v) =>
    ['sent', 'delivered', 'read', 'replied'].includes(v?.whatsapp?.status || '')
  ).length;
  const vendorWaReplied = vendors.filter((v) => v?.whatsapp?.status === 'replied').length;
  const vendorSmsDelivered = vendors.filter((v) =>
    ['sent', 'delivered', 'clicked'].includes(v?.sms?.status || '')
  ).length;
  const vendorEmailEscalated = vendors.filter((v) => v && isEmailEscalationDispatched(v)).length;
  const vendorEmailDelivered = vendors.filter(
    (v) => v && (Boolean(v.emailSent) || isEmailEscalationDispatched(v))
  ).length;

  const quotesCount = Math.max(Array.isArray(rfq.quotes) ? rfq.quotes.length : 0, rfq.quotesCount || 0);
  const vendorResponded = vendors.filter(
    (v) => v?.bidStatus === 'Submitted' || v?.overallStatus === 'Responded'
  ).length;

  const totalVendors = Math.max(
    rfq.assignedVendors?.length || 0,
    rfq.procucevVendorCount || 0,
    followUp?.totalInvited || 0,
    followUp?.whatsappStats?.total || 0,
    followUp?.smsStats?.total || 0,
    followUp?.emailStats?.total || 0,
    vendors.length
  );

  const totalInvited =
    followUp?.totalInvited ?? (vendors.length || rfq.assignedVendors?.length || 0);

  return {
    hasFollowUp,
    totalVendors,
    totalInvited,
    responded: Math.max(followUp?.respondedCount || 0, quotesCount, vendorResponded),
    callConnected:
      hasFollowUp && (followUp?.callStats?.connected !== undefined || vendorCallConnected > 0)
        ? Math.max(followUp?.callStats?.connected || 0, vendorCallConnected)
        : undefined,
    callTotal: followUp?.callStats?.total,
    waRead:
      hasFollowUp && (followUp?.whatsappStats?.read !== undefined || vendorWaRead > 0)
        ? Math.max(followUp?.whatsappStats?.read || 0, vendorWaRead)
        : undefined,
    waDelivered: hasFollowUp
      ? Math.max(
          followUp?.whatsappStats?.read || 0,
          followUp?.whatsappStats?.delivered || 0,
          followUp?.whatsappStats?.sent || 0,
          vendorWaDelivered
        )
      : undefined,
    waReplied: hasFollowUp
      ? Math.max(
          followUp?.whatsappStats?.replied || 0,
          vendorWaReplied,
          vendorResponded,
          quotesCount
        )
      : undefined,
    waTotal: hasFollowUp
      ? Math.max(followUp?.whatsappStats?.total ?? 0, followUp?.totalInvited ?? 0, vendors.length)
      : undefined,
    smsDelivered: hasFollowUp
      ? Math.max(
          followUp?.smsStats?.delivered || 0,
          followUp?.smsStats?.sent || 0,
          vendorSmsDelivered
        )
      : undefined,
    smsTotal: hasFollowUp
      ? Math.max(followUp?.smsStats?.total ?? 0, followUp?.totalInvited ?? 0, vendors.length)
      : undefined,
    emailEscalationsSent: hasFollowUp
      ? Math.max(
          followUp?.emailStats?.sent24h || 0,
          followUp?.emailStats?.delivered || 0,
          vendorEmailEscalated
        )
      : undefined,
    emailDelivered: hasFollowUp
      ? Math.max(
          followUp?.emailStats?.delivered || 0,
          followUp?.emailStats?.sent24h || 0,
          vendorEmailDelivered
        )
      : undefined,
    emailTotal: hasFollowUp
      ? Math.max(followUp?.emailStats?.total ?? 0, followUp?.totalInvited ?? 0, vendors.length)
      : undefined,
  };
}
