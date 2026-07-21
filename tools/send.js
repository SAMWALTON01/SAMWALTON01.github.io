#!/usr/bin/env node
/**
 * Inforu SMS campaign sender — CLI alternative to the dashboard.
 * Sends personalized SMS with individual funnel links via Inforu v2 JSON API.
 *
 * Usage:
 *   node send.js --dry-run                 → build everything, print, send NOTHING
 *   node send.js --send                    → actually send
 *   node send.js --file recipients.json    → recipients from file
 */

const CONFIG = {
  user: process.env.INFORU_USER || 'Shimon123',
  token: process.env.INFORU_TOKEN || '6ace5d6b-a0f6-42e0-9382-568fdef2ba0c',
  sender: process.env.INFORU_SENDER || 'nahman',
  funnelUrl: (process.env.FUNNEL_URL || 'https://lc76nj.short.gy/zk').replace(/\/+$/, ''),
  campaign: process.env.CAMPAIGN || 'rehearsal_' + new Date().toISOString().slice(0, 10),
  api: 'https://capi.inforu.co.il/api/v2/SMS/SendSms',
  batchSize: 500,
};

let RECIPIENTS = [
  // { phone: '0501234567', name: 'ישראל' },
];

const MESSAGE = [
  'שלום [#FirstName#],',
  'בדיקת זכאות מהירה להלוואה בתנאים מועדפים — ללא התחייבות:',
  '[#Representative#]',
  'להסרה השב: הסר',
].join('\n');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--send');

function toLocalPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('972')) return '0' + d.slice(3);
  if (d.startsWith('0')) return d;
  if (d.length === 9 && d.startsWith('5')) return '0' + d;
  return d;
}

function buildLink(phone, name) {
  const p = new URLSearchParams();
  p.set('p', String(phone).replace(/\D/g, ''));
  if (name) p.set('n', name);
  p.set('c', CONFIG.campaign);
  return `${CONFIG.funnelUrl}?${p.toString()}`;
}

async function main() {
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1) {
    const fs = await import('fs');
    RECIPIENTS = JSON.parse(fs.readFileSync(args[fileIdx + 1], 'utf8'));
  }

  if (!RECIPIENTS.length) {
    console.error('❌ No recipients. Edit RECIPIENTS in send.js or pass --file recipients.json');
    process.exit(1);
  }

  const valid = [];
  const skipped = [];
  for (const r of RECIPIENTS) {
    const phone = toLocalPhone(r.phone);
    if (!/^05\d{8}$/.test(phone)) { skipped.push(`${r.phone} (invalid)`); continue; }
    valid.push({
      Phone: phone,
      FirstName: r.name || '',
      Representative: buildLink(r.phone, r.name),
    });
  }

  console.log(`📣 Campaign: ${CONFIG.campaign}`);
  console.log(`👤 Sender:   ${CONFIG.sender}`);
  console.log(`🔗 Funnel:   ${CONFIG.funnelUrl}`);
  console.log(`👥 Valid:    ${valid.length} | Skipped: ${skipped.length}`);
  skipped.forEach(s => console.log(`   ⚠️  skipped ${s}`));
  console.log('─'.repeat(60));
  console.log('Sample personalized link:');
  console.log('  ', valid[0]?.Representative);
  console.log('─'.repeat(60));
  console.log('Message as recipient #1 sees it:');
  console.log(
    MESSAGE
      .replace('[#FirstName#]', valid[0]?.FirstName || '')
      .replace('[#Representative#]', valid[0]?.Representative || '')
      .split('\n').map(l => '  | ' + l).join('\n')
  );
  console.log('─'.repeat(60));

  if (DRY_RUN) {
    console.log('🧪 DRY RUN — nothing was sent. Run with --send to send for real.');
    return;
  }

  const auth = Buffer.from(`${CONFIG.user}:${CONFIG.token}`).toString('base64');
  let sent = 0;
  const errors = [];
  for (let i = 0; i < valid.length; i += CONFIG.batchSize) {
    const batch = valid.slice(i, i + CONFIG.batchSize);
    const body = {
      Data: {
        Message: MESSAGE,
        Recipients: batch,
        Settings: {
          Sender: CONFIG.sender,
          CampaignName: CONFIG.campaign,
          ShortenUrlEnable: false,
          AllowDuplicates: true,
        },
      },
    };
    console.log(`📤 Sending batch ${i / CONFIG.batchSize + 1} (${batch.length} recipients)...`);
    try {
      const res = await fetch(CONFIG.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.StatusId === 1) {
        sent += data.Data?.Recipients || batch.length;
        console.log(`   ✅ OK (RequestId: ${data.RequestId || 'n/a'})`);
      } else {
        errors.push(data.StatusDescription || `HTTP ${res.status}`);
        console.error(`   ❌ ${data.StatusDescription || res.statusText}`);
        if (String(data.StatusDescription).includes('illegal IP')) {
          console.error('   💡 Your IP is not whitelisted in Inforu → add it in the Inforu panel');
        }
      }
    } catch (e) {
      errors.push(e.message);
      console.error(`   ❌ network error: ${e.message}`);
    }
  }

  console.log('─'.repeat(60));
  console.log(`🏁 Done: ${sent}/${valid.length} sent. Campaign: "${CONFIG.campaign}"`);
  if (errors.length) console.log('Errors:', errors);
}

main();
