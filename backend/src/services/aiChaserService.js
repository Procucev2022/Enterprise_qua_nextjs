/**
 * Autonomous Multi-Channel AI Chaser Service
 * Simulates Voice AI calls, WhatsApp interactive quotes, SMS DLT alerts, and 24h Escalations
 */

function generateAIFeedItem({ type, title, message, recipient, rfqNumber, channelDetails = {} }) {
  const id = `feed-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  return {
    id,
    timestamp,
    timeAgo: 'Just now',
    type: type || 'call',
    channel: type || 'call',
    title,
    message,
    recipient: recipient || 'Vendor Partner',
    rfqNumber: rfqNumber || null,
    status: 'delivered',
    channelDetails,
  };
}

function simulateChaserOutreach(rfq, vendor) {
  const actions = [];
  const vendorName = vendor.name || 'Vendor Partner';
  const contactPerson = vendor.contactPerson || 'Sales Head';
  const phone = vendor.phone || '+91 98000 00000';
  const rfqNumber = rfq.rfqNumber || 'RFQ-2026';

  // 1. WhatsApp Delivery
  actions.push(
    generateAIFeedItem({
      type: 'whatsapp',
      title: 'WhatsApp Sourcing Broadcast Dispatched',
      message: `Interactive quotation link delivered with secure access token to ${contactPerson} (${vendorName}).`,
      recipient: `${contactPerson} (${phone})`,
      rfqNumber,
      channelDetails: {
        template: 'rfq_invitation_v2',
        dlrStatus: 'Delivered (Double Blue Tick)',
        readTimestamp: 'Immediate',
      },
    })
  );

  // 2. Autonomous Voice AI Call
  actions.push(
    generateAIFeedItem({
      type: 'call',
      title: 'Autonomous Voice AI Sourcing Call Dispatched',
      message: `Voice AI agent engaged ${contactPerson} regarding ${rfq.title}. Vendor committed to reviewing line-item specs.`,
      recipient: `${contactPerson} - ${vendorName} (${phone})`,
      rfqNumber,
      channelDetails: {
        callDuration: '1m 32s',
        sentiment: 'High Intent (Positive)',
        transcript: `AI: Hello Mr. ${contactPerson}, this is QUA AI calling on behalf of enterprise buyer. We have issued RFQ ${rfqNumber}. Can you submit a quotation by deadline? Vendor: Yes, our technical team is reviewing it now.`,
      },
    })
  );

  // 3. SMS Gateway Notice
  actions.push(
    generateAIFeedItem({
      type: 'sms',
      title: 'DLT Registered SMS Gateway Alert Dispatched',
      message: `DLT Template PRCU-RFQ-01 pushed to ${phone} with SHA-256 direct access link.`,
      recipient: phone,
      rfqNumber,
      channelDetails: {
        senderId: 'PRCUEV',
        dltApprovalId: 'DLT-1102294821',
        status: 'Sent via Azure Communication Services',
      },
    })
  );

  return actions;
}

module.exports = {
  generateAIFeedItem,
  simulateChaserOutreach,
};
