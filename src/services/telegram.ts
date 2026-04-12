import axios from 'axios';

export async function sendTelegramMessage(text: string) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('⚠️ Telegram credentials missing. Skipping notification.');
    throw new Error('Telegram credentials missing (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
    console.log('✅ Telegram notification sent');
  } catch (error) {
    console.error('❌ Failed to send Telegram message:', error instanceof Error ? error.message : String(error));
  }
}

export function formatTenderMessage(tender: any) {
  const budget = tender.budget 
    ? `💰 <b>Budget:</b> ${new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD' }).format(tender.budget)}`
    : '💰 <b>Budget:</b> Non spécifié';

  return `
🚀 <b>Nouvel Appel d'Offres PMMP</b>

📝 <b>Objet:</b> ${tender.title}
🏢 <b>Organisme:</b> ${tender.organization}
📂 <b>Catégorie:</b> ${tender.category}
📍 <b>Région:</b> ${tender.region}
📅 <b>Date Limite:</b> ${new Date(tender.deadline).toLocaleDateString('fr-FR')}
${budget}
🆔 <b>Réf:</b> <code>${tender.reference}</code>

🔗 <a href="${tender.url}">Voir les détails sur le portail</a>
  `.trim();
}
