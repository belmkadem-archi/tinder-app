import axios from 'axios';

export async function sendTelegramMessage(text: string): Promise<void> {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('Telegram credentials missing: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
  }

  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  });

  console.log('✅ Telegram notification sent');
}

export function formatTenderMessage(tender: {
  title: string;
  organization: string;
  category: string;
  region: string;
  deadline: string;
  budget?: number | null;
  reference: string;
  url?: string | null;
}): string {
  const budget = tender.budget
    ? `💰 <b>Budget:</b> ${new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD', maximumFractionDigits: 0 }).format(tender.budget)}`
    : '💰 <b>Budget:</b> Non spécifié';

  const link = tender.url
    ? `\n🔗 <a href="${tender.url}">Voir sur le portail PMMP</a>`
    : '';

  return `🚀 <b>Nouvel Appel d'Offres</b>

📝 <b>Objet:</b> ${tender.title}
🏢 <b>Organisme:</b> ${tender.organization}
📂 <b>Catégorie:</b> ${tender.category}
📍 <b>Région:</b> ${tender.region}
📅 <b>Date limite:</b> ${new Date(tender.deadline).toLocaleDateString('fr-FR')}
${budget}
🆔 <b>Réf:</b> <code>${tender.reference}</code>${link}`.trim();
}
