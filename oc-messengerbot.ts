import {
  BotContext,
  IncomingMessage,
  OutgoingMessage,
  OutgoingTextContent,
  ParsedTextContent,
  Database,
  sendMessage,
} from "openchat-bots";
import { 
  TelegramClient, 
  Api as TelegramApi 
} from "telegram";
import { StringSession } from "telegram/sessions";
import { Client as DiscordClient, GatewayIntentBits } from "discord.js";
import { WebClient as SlackClient } from "@slack/web-api";
import { RTMClient as SlackRTMClient } from "@slack/rtm-api";

interface UserConfig {
  userId: string;
  telegramConfig?: {
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    session?: string;
  };
  discordConfig?: {
    token: string;
    channelsToTrack: string[];
  };
  slackConfig?: {
    token: string;
    channelsToTrack: string[];
  };
  platformClients: {
    telegram?: any;
    discord?: any;
    slack?: any;
    slackRtm?: any;
  };
  messageHistory: {
    telegram: Map<string, any[]>;
    discord: Map<string, any[]>;
    slack: Map<string, any[]>;
  };
}

// Initialize our user database
const users = new Map<string, UserConfig>();
const MAX_HISTORY_PER_CHANNEL = 500; // Maximum number of messages to store per channel

// Helper for storing messages in memory
function storeMessage(userId: string, platform: 'telegram' | 'discord' | 'slack', channelId: string, message: any) {
  const user = users.get(userId);
  if (!user) return;

  if (!user.messageHistory[platform].has(channelId)) {
    user.messageHistory[platform].set(channelId, []);
  }

  const channelMessages = user.messageHistory[platform].get(channelId);
  channelMessages?.push(message);

  // Trim the history if it exceeds our limit
  if (channelMessages && channelMessages.length > MAX_HISTORY_PER_CHANNEL) {
    channelMessages.shift();
  }
}

// Connect to Telegram
async function setupTelegram(userId: string, config: UserConfig['telegramConfig']) {
  if (!config) return null;
  
  try {
    const session = config.session 
      ? new StringSession(config.session) 
      : new StringSession("");
    
    const client = new TelegramClient(
      session, 
      config.apiId, 
      config.apiHash, 
      { connectionRetries: 5 }
    );

    await client.start({
      phoneNumber: config.phoneNumber,
      phoneCode: async () => {
        // In a real implementation, we'd need to prompt the user for the code
        // For this example, we'll simulate a way to get the code
        return await new Promise(resolve => {
          setTimeout(() => resolve("12345"), 1000); // This is just a placeholder
        });
      },
      onError: (err) => console.log(err),
    });

    // Save the session string for future use
    const sessionString = client.session.save() as string;
    
    // Update the user's config with the session
    const user = users.get(userId);
    if (user && user.telegramConfig) {
      user.telegramConfig.session = sessionString;
    }

    // Add event handler for new messages
    client.addEventHandler(async (event) => {
      if (event instanceof TelegramApi.Message) {
        const message = event;
        const chat = await message.getChat();
        const sender = await message.getSender();
        
        // Store the message in our history
        storeMessage(userId, 'telegram', chat.id.toString(), {
          id: message.id,
          text: message.text,
          date: message.date,
          chatId: chat.id.toString(),
          chatTitle: 'title' in chat ? chat.title : 'Private Chat',
          senderId: sender ? sender.id.toString() : 'unknown',
          senderName: sender && 'firstName' in sender ? sender.firstName : 'Unknown User',
        });

        // Send notification to the user
        if (message.text) {
          const notification = `💬 New Telegram message from ${
            'firstName' in sender ? sender.firstName : 'Unknown'
          } in ${
            'title' in chat ? chat.title : 'Private Chat'
          }: ${message.text.substring(0, 100)}${message.text.length > 100 ? '...' : ''}`;
          
          await sendMessage({
            to: { userId },
            content: {
              kind: "text",
              text: notification,
            },
          });
        }
      }
    });

    return client;
  } catch (error) {
    console.error("Error setting up Telegram:", error);
    return null;
  }
}

// Connect to Discord
async function setupDiscord(userId: string, config: UserConfig['discordConfig']) {
  if (!config) return null;
  
  try {
    const client = new DiscordClient({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    await client.login(config.token);

    // Listen for new messages
    client.on('messageCreate', async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;
      
      // Check if this channel is being tracked
      if (config.channelsToTrack.includes(message.channelId)) {
        // Store the message
        storeMessage(userId, 'discord', message.channelId, {
          id: message.id,
          content: message.content,
          timestamp: message.createdTimestamp,
          channelId: message.channelId,
          channelName: message.channel.name || 'Unknown Channel',
          authorId: message.author.id,
          authorName: message.author.username,
        });

        // Send notification to the user
        const notification = `🎮 New Discord message from ${message.author.username} in #${
          message.channel.name || 'Unknown Channel'
        }: ${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}`;
        
        await sendMessage({
          to: { userId },
          content: {
            kind: "text",
            text: notification,
          },
        });
      }
    });

    return client;
  } catch (error) {
    console.error("Error setting up Discord:", error);
    return null;
  }
}

// Connect to Slack
async function setupSlack(userId: string, config: UserConfig['slackConfig']) {
  if (!config) return null;
  
  try {
    // Initialize Slack Web API client
    const client = new SlackClient(config.token);
    
    // Initialize Slack RTM client for real-time messaging
    const rtm = new SlackRTMClient(config.token);
    
    // Start RTM connection
    await rtm.start();
    
    // Listen for new messages
    rtm.on('message', async (event) => {
      // Ignore bot messages or messages without text
      if (!event.text || event.bot_id) return;
      
      // Check if this channel is being tracked
      if (config.channelsToTrack.includes(event.channel)) {
        // Get channel info
        const channelInfo = await client.conversations.info({
          channel: event.channel,
        });
        
        // Get user info
        const userInfo = await client.users.info({
          user: event.user,
        });
        
        // Store the message
        storeMessage(userId, 'slack', event.channel, {
          id: event.ts,
          text: event.text,
          timestamp: parseInt(event.ts.split('.')[0]) * 1000,
          channelId: event.channel,
          channelName: channelInfo.channel?.name || 'Unknown Channel',
          userId: event.user,
          userName: userInfo.user?.real_name || 'Unknown User',
        });
        
        // Send notification to the user
        const notification = `💼 New Slack message from ${
          userInfo.user?.real_name || 'Unknown User'
        } in #${
          channelInfo.channel?.name || 'Unknown Channel'
        }: ${event.text.substring(0, 100)}${event.text.length > 100 ? '...' : ''}`;
        
        await sendMessage({
          to: { userId },
          content: {
            kind: "text",
            text: notification,
          },
        });
      }
    });
    
    return { client, rtm };
  } catch (error) {
    console.error("Error setting up Slack:", error);
    return null;
  }
}

// Main entry point for bot execution
export default async function messageHandler(
  context: BotContext,
  message: IncomingMessage,
): Promise<OutgoingMessage[]> {
  try {
    const { text } = message.content as ParsedTextContent;
    const userId = message.from.userId;
    const userKey = userId.toString();

    // Initialize user if they don't exist yet
    if (!users.has(userKey)) {
      users.set(userKey, {
        userId: userKey,
        platformClients: {},
        messageHistory: {
          telegram: new Map(),
          discord: new Map(),
          slack: new Map(),
        },
      });
    }

    // Process commands
    if (text.startsWith("/setup")) {
      return handleSetupCommand(text, userKey);
    } else if (text.startsWith("/connect")) {
      return handleConnectCommand(text, userKey);
    } else if (text.startsWith("/status")) {
      return handleStatusCommand(userKey);
    } else if (text.startsWith("/list")) {
      return handleListCommand(text, userKey);
    } else if (text.startsWith("/disconnect")) {
      return handleDisconnectCommand(text, userKey);
    } else if (text.startsWith("/help")) {
      return handleHelpCommand();
    } else {
      // Treat any other message as a query
      return handleUserQuery(text, userKey);
    }
  } catch (error) {
    console.error("Error processing message:", error);
    return [
      {
        content: {
          kind: "text",
          text: "Sorry, an error occurred while processing your message. Please try again.",
        },
      },
    ];
  }
}

// Handle the setup command
async function handleSetupCommand(
  text: string,
  userId: string
): Promise<OutgoingMessage[]> {
  const parts = text.split(" ");
  const platform = parts[1]?.toLowerCase();
  
  if (!platform) {
    return [
      {
        content: {
          kind: "text",
          text: "Please specify a platform: /setup telegram|discord|slack",
        },
      },
    ];
  }
  
  let response: string;
  
  switch (platform) {
    case "telegram":
      response = `To set up Telegram, please provide your API ID and hash by using the command:
      
/connect telegram <apiId> <apiHash> <phoneNumber>

You can get your API credentials from https://my.telegram.org/apps`;
      break;
    
    case "discord":
      response = `To set up Discord, please provide your bot token by using the command:
      
/connect discord <botToken>

You can create a bot and get your token from https://discord.com/developers/applications`;
      break;
    
    case "slack":
      response = `To set up Slack, please provide your bot token by using the command:
      
/connect slack <botToken>

You can create a bot and get your token from https://api.slack.com/apps`;
      break;
    
    default:
      response = `Unsupported platform '${platform}'. Currently supported platforms are: telegram, discord, slack`;
  }
  
  return [
    {
      content: {
        kind: "text",
        text: response,
      },
    },
  ];
}

// Handle the connect command
async function handleConnectCommand(
  text: string,
  userId: string
): Promise<OutgoingMessage[]> {
  const parts = text.split(" ");
  const platform = parts[1]?.toLowerCase();
  
  if (!platform || !["telegram", "discord", "slack"].includes(platform)) {
    return [
      {
        content: {
          kind: "text",
          text: "Please specify a valid platform: /connect telegram|discord|slack ...",
        },
      },
    ];
  }
  
  const user = users.get(userId);
  if (!user) {
    return [
      {
        content: {
          kind: "text",
          text: "User data not found. Please try again.",
        },
      },
    ];
  }
  
  let response: string;
  
  try {
    switch (platform) {
      case "telegram": {
        const apiId = Number(parts[2]);
        const apiHash = parts[3];
        const phoneNumber = parts[4];
        
        if (!apiId || !apiHash || !phoneNumber) {
          return [
            {
              content: {
                kind: "text",
                text: "Please provide all required parameters: /connect telegram <apiId> <apiHash> <phoneNumber>",
              },
            },
          ];
        }
        
        user.telegramConfig = { apiId, apiHash, phoneNumber };
        
        // In a real bot, we would need to handle the verification code flow
        // For this example, we're simplifying
        response = "Connecting to Telegram... This may take a moment.";
        
        // Send initial response
        await sendMessage({
          to: { userId },
          content: {
            kind: "text",
            text: response,
          },
        });
        
        // Connect to Telegram
        const client = await setupTelegram(userId, user.telegramConfig);
        
        if (client) {
          user.platformClients.telegram = client;
          response = "Successfully connected to Telegram! You will now receive message notifications here.";
        } else {
          response = "Failed to connect to Telegram. Please check your credentials and try again.";
        }
        break;
      }
      
      case "discord": {
        const token = parts.slice(2).join(" ");
        
        if (!token) {
          return [
            {
              content: {
                kind: "text",
                text: "Please provide your Discord bot token: /connect discord <botToken>",
              },
            },
          ];
        }
        
        user.discordConfig = { token, channelsToTrack: [] };
        
        // Send initial response
        response = "Connecting to Discord... This may take a moment.";
        await sendMessage({
          to: { userId },
          content: {
            kind: "text",
            text: response,
          },
        });
        
        // Connect to Discord
        const client = await setupDiscord(userId, user.discordConfig);
        
        if (client) {
          user.platformClients.discord = client;
          
          // Get available channels
          const availableChannels = client.channels.cache
            .filter(channel => channel.isTextBased())
            .map(channel => ({
              id: channel.id,
              name: 'name' in channel ? channel.name : 'Unknown Channel',
              guild: 'guild' in channel && channel.guild ? channel.guild.name : 'Direct Message',
            }));
          
          // Add all channels by default
          user.discordConfig.channelsToTrack = availableChannels.map(channel => channel.id);
          
          response = `Successfully connected to Discord! You will now receive message notifications from ${availableChannels.length} channels.
          
To get a list of channels, use /list discord`;
        } else {
          response = "Failed to connect to Discord. Please check your token and try again.";
        }
        break;
      }
      
      case "slack": {
        const token = parts.slice(2).join(" ");
        
        if (!token) {
          return [
            {
              content: {
                kind: "text",
                text: "Please provide your Slack bot token: /connect slack <botToken>",
              },
            },
          ];
        }
        
        user.slackConfig = { token, channelsToTrack: [] };
        
        // Send initial response
        response = "Connecting to Slack... This may take a moment.";
        await sendMessage({
          to: { userId },
          content: {
            kind: "text",
            text: response,
          },
        });
        
        // Connect to Slack
        const clients = await setupSlack(userId, user.slackConfig);
        
        if (clients) {
          user.platformClients.slack = clients.client;
          user.platformClients.slackRtm = clients.rtm;
          
          // Get available channels
          const channelsResult = await clients.client.conversations.list({
            types: "public_channel,private_channel",
          });
          
          const availableChannels = channelsResult.channels || [];
          
          // Add all channels by default
          user.slackConfig.channelsToTrack = availableChannels.map(channel => channel.id as string);
          
          response = `Successfully connected to Slack! You will now receive message notifications from ${availableChannels.length} channels.
          
To get a list of channels, use /list slack`;
        } else {
          response = "Failed to connect to Slack. Please check your token and try again.";
        }
        break;
      }
      
      default:
        response = `Unsupported platform '${platform}'. Currently supported platforms are: telegram, discord, slack`;
    }
  } catch (error) {
    console.error(`Error connecting to ${platform}:`, error);
    response = `Error connecting to ${platform}: ${error instanceof Error ? error.message : String(error)}`;
  }
  
  return [
    {
      content: {
        kind: "text",
        text: response,
      },
    },
  ];
}

// Handle the status command
async function handleStatusCommand(userId: string): Promise<OutgoingMessage[]> {
  const user = users.get(userId);
  
  if (!user) {
    return [
      {
        content: {
          kind: "text",
          text: "User data not found. Please try again.",
        },
      },
    ];
  }
  
  let status = "📊 **Platform Connection Status**\n\n";
  
  // Telegram status
  status += "📱 **Telegram**: ";
  if (user.platformClients.telegram) {
    status += "✅ Connected\n";
  } else {
    status += "❌ Not connected\n";
  }
  
  // Discord status
  status += "🎮 **Discord**: ";
  if (user.platformClients.discord) {
    const channelCount = user.discordConfig?.channelsToTrack.length || 0;
    status += `✅ Connected (tracking ${channelCount} channels)\n`;
  } else {
    status += "❌ Not connected\n";
  }
  
  // Slack status
  status += "💼 **Slack**: ";
  if (user.platformClients.slack) {
    const channelCount = user.slackConfig?.channelsToTrack.length || 0;
    status += `✅ Connected (tracking ${channelCount} channels)\n`;
  } else {
    status += "❌ Not connected\n";
  }
  
  // Message statistics
  status += "\n📝 **Message History**\n";
  
  let totalMessages = 0;
  
  // Telegram messages
  let telegramMessages = 0;
  for (const messages of user.messageHistory.telegram.values()) {
    telegramMessages += messages.length;
  }
  status += `- Telegram: ${telegramMessages} messages\n`;
  totalMessages += telegramMessages;
  
  // Discord messages
  let discordMessages = 0;
  for (const messages of user.messageHistory.discord.values()) {
    discordMessages += messages.length;
  }
  status += `- Discord: ${discordMessages} messages\n`;
  totalMessages += discordMessages;
  
  // Slack messages
  let slackMessages = 0;
  for (const messages of user.messageHistory.slack.values()) {
    slackMessages += messages.length;
  }
  status += `- Slack: ${slackMessages} messages\n`;
  totalMessages += slackMessages;
  
  status += `\nTotal stored messages: ${totalMessages}`;
  
  return [
    {
      content: {
        kind: "text",
        text: status,
      },
    },
  ];
}

// Handle the list command
async function handleListCommand(
  text: string,
  userId: string
): Promise<OutgoingMessage[]> {
  const parts = text.split(" ");
  const platform = parts[1]?.toLowerCase();
  
  if (!platform || !["telegram", "discord", "slack"].includes(platform)) {
    return [
      {
        content: {
          kind: "text",
          text: "Please specify a valid platform: /list telegram|discord|slack",
        },
      },
    ];
  }
  
  const user = users.get(userId);
  if (!user) {
    return [
      {
        content: {
          kind: "text",
          text: "User data not found. Please try again.",
        },
      },
    ];
  }
  
  let response: string;
  
  switch (platform) {
    case "telegram": {
      if (!user.platformClients.telegram) {
        return [
          {
            content: {
              kind: "text",
              text: "You are not connected to Telegram. Use /connect telegram to set up your connection.",
            },
          },
        ];
      }
      
      // In a real bot, we'd list all chats
      // This is simplified for the example
      const telegramClient = user.platformClients.telegram;
      const dialogs = await telegramClient.getDialogs({});
      
      if (dialogs.length === 0) {
        response = "No Telegram chats found.";
      } else {
        response = "📱 **Telegram Chats**\n\n";
        for (const dialog of dialogs.slice(0, 20)) { // Limit to 20 for brevity
          const chat = dialog.entity;
          response += `- ${
            'title' in chat ? chat.title : ('firstName' in chat ? chat.firstName : 'Private Chat')
          } (ID: ${chat.id})\n`;
        }
        
        if (dialogs.length > 20) {
          response += `\n...and ${dialogs.length - 20} more chats.`;
        }
      }
      break;
    }
    
    case "discord": {
      if (!user.platformClients.discord) {
        return [
          {
            content: {
              kind: "text",
              text: "You are not connected to Discord. Use /connect discord to set up your connection.",
            },
          },
        ];
      }
      
      const discordClient = user.platformClients.discord;
      const channels = discordClient.channels.cache
        .filter(channel => channel.isTextBased())
        .map(channel => ({
          id: channel.id,
          name: 'name' in channel ? channel.name : 'Unknown Channel',
          guild: 'guild' in channel && channel.guild ? channel.guild.name : 'Direct Message',
        }));
      
      if (channels.length === 0) {
        response = "No Discord channels found.";
      } else {
        response = "🎮 **Discord Channels**\n\n";
        // Group by guild
        const channelsByGuild = channels.reduce((acc, channel) => {
          if (!acc[channel.guild]) {
            acc[channel.guild] = [];
          }
          acc[channel.guild].push(channel);
          return acc;
        }, {} as Record<string, typeof channels>);
        
        for (const [guild, guildChannels] of Object.entries(channelsByGuild)) {
          response += `**${guild}**\n`;
          
          for (const channel of guildChannels) {
            const isTracked = user.discordConfig?.channelsToTrack.includes(channel.id);
            response += `- ${isTracked ? '✅' : '❌'} #${channel.name} (ID: ${channel.id})\n`;
          }
          
          response += "\n";
        }
        
        response += "\n✅ = Currently tracking | ❌ = Not tracking";
      }
      break;
    }
    
    case "slack": {
      if (!user.platformClients.slack) {
        return [
          {
            content: {
              kind: "text",
              text: "You are not connected to Slack. Use /connect slack to set up your connection.",
            },
          },
        ];
      }
      
      const slackClient = user.platformClients.slack;
      const result = await slackClient.conversations.list({
        types: "public_channel,private_channel",
      });
      
      const channels = result.channels || [];
      
      if (channels.length === 0) {
        response = "No Slack channels found.";
      } else {
        response = "💼 **Slack Channels**\n\n";
        
        for (const channel of channels) {
          const isTracked = user.slackConfig?.channelsToTrack.includes(channel.id as string);
          response += `- ${isTracked ? '✅' : '❌'} #${channel.name} (ID: ${channel.id})\n`;
        }
        
        response += "\n✅ = Currently tracking | ❌ = Not tracking";
      }
      break;
    }
    
    default:
      response = `Unsupported platform '${platform}'. Currently supported platforms are: telegram, discord, slack`;
  }
  
  return [
    {
      content: {
        kind: "text",
        text: response,
      },
    },
  ];
}

// Handle the disconnect command
async function handleDisconnectCommand(
  text: string,
  userId: string
): Promise<OutgoingMessage[]> {
  const parts = text.split(" ");
  const platform = parts[1]?.toLowerCase();
  
  if (!platform || !["telegram", "discord", "slack", "all"].includes(platform)) {
    return [
      {
        content: {
          kind: "text",
          text: "Please specify a valid platform: /disconnect telegram|discord|slack|all",
        },
      },
    ];
  }
  
  const user = users.get(userId);
  if (!user) {
    return [
      {
        content: {
          kind: "text",
          text: "User data not found. Please try again.",
        },
      },
    ];
  }
  
  const disconnectPlatform = async (platformName: 'telegram' | 'discord' | 'slack') => {
    let message = "";
    
    switch (platformName) {
      case "telegram":
        if (user.platformClients.telegram) {
          await user.platformClients.telegram.disconnect();
          user.platformClients.telegram = undefined;
          user.telegramConfig = undefined;
          message = "✅ Disconnected from Telegram.";
        } else {
          message = "❌ You are not connected to Telegram.";
        }
        break;
      
      case "discord":
        if (user.platformClients.discord) {
          await user.platformClients.discord.destroy();
          user.platformClients.discord = undefined;
          user.discordConfig = undefined;
          message = "✅ Disconnected from Discord.";
        } else {
          message = "❌ You are not connected to Discord.";
        }
        break;
      
      case "slack":
        if (user.platformClients.slackRtm) {
          await user.platformClients.slackRtm.disconnect();
          user.platformClients.slack = undefined;
          user.platformClients.slackRtm = undefined;
          user.slackConfig = undefined;
          message = "✅ Disconnected from Slack.";
        } else {
          message = "❌ You are not connected to Slack.";
        }
        break;
    }
    
    return message;
  };
  
  let response = "";
  
  if (platform === "all") {
    response += await disconnectPlatform("telegram") + "\n";
    response += await disconnectPlatform("discord") + "\n";
    response += await disconnectPlatform("slack");
    
    // Clear message history
    user.messageHistory = {
      telegram: new Map(),
      discord: new Map(),
      slack: new Map(),
    };
    
    response += "\n\nAll message history has been cleared.";
  } else {
    response = await disconnectPlatform(platform as 'telegram' | 'discord' | 'slack');
    
    // Clear platform message history
    user.messageHistory[platform as 'telegram' | 'discord' | 'slack'] = new Map();
    
    response += "\n\nMessage history for this platform has been cleared.";
  }
  
  return [
    {
      content: {
        kind: "text",
        text: response,
      },
    },
  ];
}

// Handle the help command
async function handleHelpCommand(): Promise<OutgoingMessage[]> {
  return [
    {
      content: {
        kind: "text",
        text: `🤖 **OpenChat Messenger Bot Help**

This bot allows you to integrate your Telegram, Discord, and Slack accounts with OpenChat.

**Commands:**

/help - Show this help message
/setup <platform> - Get setup instructions for a platform (telegram, discord, slack)
/connect <platform> <credentials> - Connect to a messaging platform
/status - Check your connection status and message statistics
/list <platform> - List available channels/chats for a platform
/disconnect <platform> - Disconnect from a platform (use "all" to disconnect from all)

**Asking Questions About Your Messages:**

You can ask natural language questions about your messages, for example:

- "What did John say in the #general Discord channel yesterday?"
- "Show me the last 5 messages from my Telegram group 'Work Team'"
- "Summarize today's Slack conversation in the #project-alpha channel"
- "Did anyone mention the quarterly report in Slack?"

The bot will search through your message history and provide relevant information.`,
      },
    },
  ];
}

// Handle natural language queries about messages
async function handleUserQuery(
  query: string,
  userId: string
): Promise<OutgoingMessage[]> {
  const user = users.get(userId);
  if (!user) {
    return [
      {
        content: {
          kind: "text",
          text: "User data not found. Please try again.",
        },
      },
    ];
  }
  
  // Check if any platforms are connected
  const anyConnected = 
    !!user.platformClients.telegram || 
    !!user.platformClients.discord || 
    !!user.platformClients.slack;
  
  if (!anyConnected) {
    return [
      {
        content: {
          kind: "text",
          text: "You are not connected to any messaging platforms. Use /setup to get started.",
        },
      },
    ];
  }
  
  // Simple NLP for detecting platforms, time ranges, and keywords
  const platformKeywords = {
    telegram: ["telegram", "tg"],
    discord: ["discord", "dc", "server"],
    slack: ["slack", "sl"],
  };
  
  const timeKeywords = {
    recent: ["recent", "latest", "last", "newest"],
    today: ["today", "this day"],
    yesterday: ["yesterday", "past day"],
    thisWeek: ["this week", "past week", "last 7 days"],
  };
  
  // Detect which platform(s) the query is about
  let platforms: ('telegram' | 'discord' | 'slack')[] = [];
  
  for (const [platform, keywords] of Object.entries(platformKeywords)) {
    if (keywords.some(keyword => query.toLowerCase().includes(keyword))) {
      platforms.push(platform as 'telegram' | 'discord' | 'slack');
    }
  }
  
  // If no specific platform mentioned, search all connected platforms
  if (platforms.length === 0) {
    if (user.platformClients.telegram) platforms.push('telegram');
    if (user.platformClients.discord) platforms.push('discord');
    if (user.platformClients.slack) platforms.push('slack');
  }
  
  // Detect time range
  let timeRange = 'recent'; // Default to recent
  
  for (const [range, keywords] of Object.entries(timeKeywords)) {
    if (keywords.some(keyword => query.toLowerCase().includes(keyword))) {
      timeRange = range;
      break;
    }
  }
  
  // Extract important keywords (excluding common words)
  const commonWords = new Set([
    "the", "and", "a", "an", "in", "on", "at", "from", "to", "with", "by", "about",
    "for", "of", "as", "what", "who", "when", "where", "why", "how", "did", "does",
    "do", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "that", "this", "these", "those", "it", "they", "them", "their", "there",
    "show", "tell", "find", "get", "see", "look", "search",
  ]);
  
  const queryWords = query.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word));
  
  // Get channel/chat names or IDs if mentioned
  let channelMentions: string[] = [];
  
  // Check for channel or chat name patterns
  const channelPattern = /#([a-zA-Z0-9_-]+)/g;
  const channelMatches = query.match(channelPattern);
  
  if (channelMatches) {
    channelMentions = channelMatches.map(match => match.substring(1));
  }
  
  // Check for quoted names (e.g., "General Chat")
  const quotedPattern = /"([^"]+)"|'([^']+)'/g;
  let match;
  while ((match = quotedPattern.exec(query)) !== null) {
    channelMentions.push(match[1] || match[2]);
  }
  
  // Function to search through messages
  const searchMessages = (
    platform: 'telegram' | 'discord' | 'slack',
    keywords: string[],
    channelHints: string[],
    timeRange: string
  ): {
    messages: any[];
    channelInfo: {
      id: string;
      name: string;
    };
  }[] => {
    const results: {
      messages: any[];
      channelInfo: {
        id: string;
        name: string;
      };
    }[] = [];
    
    // Get current timestamp for date calculations
    const now = Date.now();
    let cutoffTime = now;
    
    // Calculate cutoff time based on time range
    switch (timeRange) {
      case 'today':
        cutoffTime = new Date().setHours(0, 0, 0, 0);
        break;
      case 'yesterday':
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        cutoffTime = yesterday.setHours(0, 0, 0, 0);
        break;
      case 'thisWeek':
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        cutoffTime = weekAgo.getTime();
        break;
      default:
        // For 'recent', use last 24 hours
        cutoffTime = now - 24 * 60 * 60 * 1000;
    }
    
    const platformHistory = user.messageHistory[platform];
    
    // Filter channels based on channel hints
    let channelsToSearch = Array.from(platformHistory.keys());
    
    if (channelHints.length > 0) {
      channelsToSearch = channelsToSearch.filter(channelId => {
        // Get messages from this channel to extract channel name
        const messages = platformHistory.get(channelId) || [];
        if (messages.length === 0) return false;
        
        // Extract channel name from messages
        const channelName = 
          platform === 'telegram' ? messages[0].chatTitle :
          platform === 'discord' ? messages[0].channelName :
          messages[0].channelName;
        
        // Check if channel name matches any of the hints
        return channelHints.some(hint => 
          channelName.toLowerCase().includes(hint.toLowerCase()) ||
          channelId === hint
        );
      });
    }
    
    // Search each channel for matching messages
    for (const channelId of channelsToSearch) {
      const messages = platformHistory.get(channelId) || [];
      
      // Skip empty channels
      if (messages.length === 0) continue;
      
      // Get channel name
      const channelName = 
        platform === 'telegram' ? messages[0].chatTitle :
        platform === 'discord' ? messages[0].channelName :
        messages[0].channelName;
      
      // Filter messages by time and keywords
      const matchingMessages = messages.filter(message => {
        // Get message timestamp
        const timestamp = 
          platform === 'telegram' ? message.date * 1000 :
          platform === 'discord' ? message.timestamp :
          message.timestamp;
        
        // Check if message is within time range
        if (timestamp < cutoffTime) return false;
        
        // Get message text
        const text = 
          platform === 'telegram' ? message.text :
          platform === 'discord' ? message.content :
          message.text;
        
        // If no keywords specified, return all messages in time range
        if (keywords.length === 0) return true;
        
        // Check if message contains any of the keywords
        return keywords.some(keyword => 
          text.toLowerCase().includes(keyword.toLowerCase())
        );
      });
      
      // Add to results if there are matching messages
      if (matchingMessages.length > 0) {
        results.push({
          messages: matchingMessages,
          channelInfo: {
            id: channelId,
            name: channelName,
          },
        });
      }
    }
    
    return results;
  };
  
  // Search for messages across platforms
  const searchResults: Record<string, any[]> = {};
  
  for (const platform of platforms) {
    const results = searchMessages(platform, queryWords, channelMentions, timeRange);
    if (results.length > 0) {
      searchResults[platform] = results;
    }
  }
  
  // Format the results into a response
  let response: string;
  
  if (Object.keys(searchResults).length === 0) {
    response = `I couldn't find any messages matching your query "${query}".
    
Try refining your search or make sure you're connected to the relevant platforms.`;
  } else {
    response = `📝 **Search Results for "${query}"**\n\n`;
    
    // Function to format message for display
    const formatMessage = (message: any, platform: string): string => {
      switch (platform) {
        case 'telegram':
          return `**${message.senderName}**: ${message.text}`;
        
        case 'discord':
          return `**${message.authorName}**: ${message.content}`;
        
        case 'slack':
          return `**${message.userName}**: ${message.text}`;
        
        default:
          return "Unknown message format";
      }
    };
    
    // Format timestamp for display
    const formatTimestamp = (timestamp: number): string => {
      const date = new Date(timestamp);
      return date.toLocaleString();
    };
    
    // Keep track of total messages displayed
    let totalMessagesDisplayed = 0;
    const MAX_MESSAGES_TO_DISPLAY = 20;
    
    // Process each platform's results
    for (const [platform, platformResults] of Object.entries(searchResults)) {
      // Skip if we've already shown too many messages
      if (totalMessagesDisplayed >= MAX_MESSAGES_TO_DISPLAY) break;
      
      // Add platform header
      response += `**${platform.charAt(0).toUpperCase() + platform.slice(1)} Results:**\n\n`;
      
      for (const result of platformResults) {
        // Skip if we've already shown too many messages
        if (totalMessagesDisplayed >= MAX_MESSAGES_TO_DISPLAY) break;
        
        // Add channel header
        response += `**Channel: ${result.channelInfo.name}**\n`;
        
        // Sort messages by timestamp (newest first)
        const sortedMessages = [...result.messages].sort((a, b) => {
          const timestampA = 
            platform === 'telegram' ? a.date * 1000 :
            platform === 'discord' ? a.timestamp :
            a.timestamp;
          
          const timestampB = 
            platform === 'telegram' ? b.date * 1000 :
            platform === 'discord' ? b.timestamp :
            b.timestamp;
          
          return timestampB - timestampA;
        });
        
        // Display messages (limit to a reasonable number)
        const messagesToShow = sortedMessages.slice(0, MAX_MESSAGES_TO_DISPLAY - totalMessagesDisplayed);
        totalMessagesDisplayed += messagesToShow.length;
        
        for (const message of messagesToShow) {
          const timestamp = 
            platform === 'telegram' ? message.date * 1000 :
            platform === 'discord' ? message.timestamp :
            message.timestamp;
          
          response += `[${formatTimestamp(timestamp)}] ${formatMessage(message, platform)}\n\n`;
        }
        
        // Add a separator between channels
        response += '\n';
      }
    }
    
    // Add a note if there were more messages than we displayed
    const totalMessages = Object.values(searchResults)
      .flatMap(results => results.flatMap(result => result.messages))
      .length;
    
    if (totalMessages > totalMessagesDisplayed) {
      response += `\n_Showing ${totalMessagesDisplayed} of ${totalMessages} matching messages. Refine your search to see more specific results._`;
    }
  }
  
  return [
    {
      content: {
        kind: "text",
        text: response,
      },
    },
  ];
}
  