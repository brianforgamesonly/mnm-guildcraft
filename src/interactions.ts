import { InteractionResponseFlags, InteractionResponseType, InteractionType } from 'discord-interactions';
import { HELP_TEXT } from './commands/help.ts';

export interface Interaction {
  type: number;
  data?: {
    name?: string;
    options?: { type: number; name: string }[];
  };
}

export type InteractionReply =
  | { type: InteractionResponseType.PONG }
  | { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE; data: { content: string; flags: number } }
  | { type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT; data: { choices: [] } };

export const NOT_YET =
  "Sorry, that command isn't available yet. Type `/craft help` to see what's coming.";

function ephemeral(content: string): InteractionReply {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL },
  };
}

export function handleInteraction(interaction: Interaction): InteractionReply {
  switch (interaction.type) {
    case InteractionType.PING:
      return { type: InteractionResponseType.PONG };
    case InteractionType.APPLICATION_COMMAND: {
      const sub = interaction.data?.options?.[0]?.name;
      if (interaction.data?.name === 'craft' && sub === 'help') return ephemeral(HELP_TEXT);
      return ephemeral(NOT_YET);
    }
    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE:
      return { type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } };
    default:
      return ephemeral(NOT_YET);
  }
}
