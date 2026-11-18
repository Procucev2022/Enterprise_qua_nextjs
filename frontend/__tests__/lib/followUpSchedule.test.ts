import {
  addBusinessMinutes,
  computeRFQFollowUpMetrics,
  computeRFQFollowUpTimes,
  normalizeFollowUpVendors,
} from '@/lib/followUpSchedule';
import type { RFQFollowUpBreakdown, RFQItem, VendorFollowUpRecord } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

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

describe('normalizeFollowUpVendors', () => {
  it('falls back to assignedVendors when followUpData.vendors is omitted', () => {
    const rows = normalizeFollowUpVendors({
      assignedVendors: [
        { id: 'v-a1', name: 'Assigned Vendor A', contactPerson: 'Ravi', phone: '9876543210' },
        { id: '', name: '' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      vendorId: 'v-a1',
      vendorName: 'Assigned Vendor A',
      contactPerson: 'Ravi',
      phone: '9876543210',
      overallStatus: 'Pending',
      bidStatus: 'Pending',
      call: { status: 'not_dispatched' },
      whatsapp: { status: 'not_dispatched' },
      sms: { status: 'not_dispatched' },
    });
    expect(rows[1]).toMatchObject({
      vendorId: 'v-2',
      vendorName: UI_STRINGS.recordPlaceholders.notRecorded,
      contactPerson: '',
      phone: '',
    });
  });

  it('returns an empty list when neither followUpData.vendors nor assignedVendors exist', () => {
    expect(normalizeFollowUpVendors({})).toEqual([]);
  });

  it('normalizes legacy id/name keys, derived overallStatus, and nested email channel objects', () => {
    const emailObj = { status: 'sent' as const, is24hReminderSent: true, lastAttempt: '2026-11-17T10:00:00Z' };
    const rows = normalizeFollowUpVendors({
      followUpData: {
        rfqNumber: 'RFQ-LEGACY-1',
        totalInvited: 3,
        respondedCount: 1,
        autoChasingEnabled: true,
        callStats: { total: 0, connected: 0, avgDuration: '0s' },
        whatsappStats: { total: 3, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: 3, delivered: 0, clicked: 0 },
        emailStats: { total: 3, sent24h: 0, opened: 0 },
        vendors: [
          {
            id: 'legacy-v1',
            name: 'Legacy Name Co',
            bidStatus: 'Submitted',
            email: emailObj,
            lastInteraction: '2026-11-17T10:05:00Z',
          } as unknown as VendorFollowUpRecord,
          {
            vendorId: '',
            vendorName: '',
            email: 'plain@vendor.test',
            lastInteraction: '',
          } as unknown as VendorFollowUpRecord,
          {
            vendorId: 'v-full',
            vendorName: 'Full Record Co',
            phone: '',
            contactPerson: '',
            overallStatus: 'Escalated',
            lastInteraction: '2026-11-17T11:00:00Z',
            bidStatus: 'Pending',
            call: { status: 'connected', lastAttempt: '2026-11-17T11:00:00Z' },
            whatsapp: { status: 'read', lastAttempt: '2026-11-17T11:00:00Z' },
            sms: { status: 'sent', lastAttempt: '2026-11-17T11:00:00Z' },
            email24h: { is24hReminderSent: true, status: 'delivered', lastAttempt: '2026-11-17T11:00:00Z' },
          },
        ],
      },
    });

    expect(rows[0]).toMatchObject({
      vendorId: 'legacy-v1',
      vendorName: 'Legacy Name Co',
      bidStatus: 'Submitted',
      overallStatus: 'Responded',
      email24h: emailObj,
      call: { status: 'not_dispatched' },
      whatsapp: { status: 'not_dispatched' },
      sms: { status: 'not_dispatched' },
    });
    expect(rows[1]).toMatchObject({
      vendorId: 'v-2',
      vendorName: UI_STRINGS.recordPlaceholders.notRecorded,
      bidStatus: 'Pending',
      overallStatus: 'Pending',
      email24h: undefined,
    });
    expect(rows[2]).toMatchObject({
      vendorId: 'v-full',
      vendorName: 'Full Record Co',
      overallStatus: 'Escalated',
      email24h: { is24hReminderSent: true, status: 'delivered' },
    });
  });
});

describe('computeRFQFollowUpMetrics', () => {
  it('returns undefined channel telemetry when followUpData is absent', () => {
    const metrics = computeRFQFollowUpMetrics({
      procucevVendorCount: 4,
      quotesCount: 1,
      quotes: [],
    });
    expect(metrics).toEqual({
      hasFollowUp: false,
      totalVendors: 4,
      totalInvited: 0,
      responded: 1,
      callConnected: undefined,
      callTotal: undefined,
      waRead: undefined,
      waDelivered: undefined,
      waReplied: undefined,
      waTotal: undefined,
      smsDelivered: undefined,
      smsTotal: undefined,
      emailEscalationsSent: undefined,
      emailDelivered: undefined,
      emailTotal: undefined,
    });
  });

  it('reconciles summary sent/replied/delivered counts with per-vendor channel statuses and quotes', () => {
    const metrics = computeRFQFollowUpMetrics({
      assignedVendors: [{ id: 'a1', name: 'A1' }],
      quotesCount: 1,
      quotes: [{ id: 'q1' } as unknown as RFQItem['quotes'][number]],
      followUpData: {
        rfqNumber: 'RFQ-METRICS-1',
        totalInvited: 4,
        respondedCount: 0,
        autoChasingEnabled: true,
        callStats: { connected: 0, total: 3, avgDuration: '0s' },
        whatsappStats: { sent: 2, delivered: 1, read: 0, replied: 0, total: 5 },
        smsStats: { sent: 4, delivered: 0, clicked: 0, total: 5 },
        emailStats: { sent24h: 2, delivered: 0, opened: 0, total: 5 },
        vendors: [
          {
            vendorId: 'v1',
            vendorName: 'Vendor 1',
            phone: '',
            contactPerson: '',
            overallStatus: 'Pending',
            lastInteraction: '',
            bidStatus: 'Pending',
            call: { status: 'connected', lastAttempt: '' },
            whatsapp: { status: 'read', lastAttempt: '' },
            sms: { status: 'sent', lastAttempt: '' },
            email24h: { is24hReminderSent: false, status: 'sent', lastAttempt: '' },
          },
          {
            vendorId: 'v2',
            vendorName: 'Vendor 2',
            phone: '',
            contactPerson: '',
            overallStatus: 'Responded',
            lastInteraction: '',
            bidStatus: 'Submitted',
            call: { status: 'completed', lastAttempt: '' },
            whatsapp: { status: 'replied', lastAttempt: '' },
            sms: { status: 'delivered', lastAttempt: '' },
            email: { status: 'delivered', is24hReminderSent: true, lastAttempt: '' },
          },
          {
            vendorId: 'v3',
            vendorName: 'Vendor 3',
            phone: '',
            contactPerson: '',
            overallStatus: 'Pending',
            lastInteraction: '',
            bidStatus: 'Pending',
            call: { status: 'in_progress', lastAttempt: '' },
            whatsapp: { status: 'delivered', lastAttempt: '' },
            sms: { status: 'clicked', lastAttempt: '' },
            emailSent: true,
          },
          {
            vendorId: 'v4',
            vendorName: 'Vendor 4',
            phone: '',
            contactPerson: '',
            overallStatus: 'Pending',
            lastInteraction: '',
            bidStatus: 'Pending',
            whatsapp: { status: 'pending', lastAttempt: '' },
            email24h: { is24hReminderSent: true, status: 'reminded_24h', lastAttempt: '' },
          } as unknown as VendorFollowUpRecord,
        ],
      },
    });

    expect(metrics).toMatchObject({
      hasFollowUp: true,
      totalVendors: 5,
      totalInvited: 4,
      responded: 1,
      callConnected: 2,
      callTotal: 3,
      waRead: 2,
      waDelivered: 3,
      waReplied: 1,
      waTotal: 5,
      smsDelivered: 4,
      smsTotal: 5,
      emailEscalationsSent: 3,
      emailDelivered: 4,
      emailTotal: 5,
    });
  });

  it('handles sparse followUpData with empty stats, non-array vendors, and connected vendors without callStats', () => {
    const withEmptyStats = computeRFQFollowUpMetrics({
      assignedVendors: [{ id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }],
      quotesCount: 0,
      quotes: [],
      followUpData: {
        vendors: undefined as unknown as VendorFollowUpRecord[],
      } as unknown as RFQFollowUpBreakdown,
    });
    expect(withEmptyStats).toMatchObject({
      hasFollowUp: true,
      totalVendors: 2,
      totalInvited: 2,
      responded: 0,
      callConnected: undefined,
      waRead: undefined,
      waDelivered: 0,
      waReplied: 0,
      waTotal: 0,
      smsDelivered: 0,
      smsTotal: 0,
      emailEscalationsSent: 0,
      emailDelivered: 0,
      emailTotal: 0,
    });

    const withVendorFallbackOnly = computeRFQFollowUpMetrics({
      quotesCount: 0,
      quotes: [],
      followUpData: {
        totalInvited: 3,
        vendors: [
          {
            vendorId: 'v1',
            vendorName: 'One',
            phone: '',
            contactPerson: '',
            overallStatus: 'Pending',
            lastInteraction: '',
            bidStatus: 'Pending',
            call: { status: 'connected', lastAttempt: '' },
            whatsapp: { status: 'read', lastAttempt: '' },
            sms: { status: 'pending', lastAttempt: '' },
            email: { status: 'sent', is24hReminderSent: false, lastAttempt: '' },
          },
        ],
      } as unknown as RFQFollowUpBreakdown,
    });
    expect(withVendorFallbackOnly).toMatchObject({
      callConnected: 1,
      waRead: 1,
      waDelivered: 1,
      waTotal: 3,
      smsDelivered: 0,
      smsTotal: 3,
      emailEscalationsSent: 1,
      emailDelivered: 1,
      emailTotal: 3,
    });
  });
});
