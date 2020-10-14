import { getNotificationsInformation } from '@core/configs';
import { Webhook, MessageBuilder } from 'discord-webhook-node';

const config = getNotificationsInformation().discord;
const hook = new Webhook(config.url);

interface MessageProperties {
  color?: number;
  image?: string;
  message: string;
  title?: string;
}

export const sendMessage = async ({ color, image, message, title }: MessageProperties) => {
  const embed = new MessageBuilder().setDescription(message);

  embed.setText('@here');

  if (title) embed.setTitle(title);

  if (color) embed.setColor(color);

  await hook.send(embed);

  if (image) await hook.sendFile(image);
};
