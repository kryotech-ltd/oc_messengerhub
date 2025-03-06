# MessengerHub Bot for OpenChat

MessengerHub is an OpenChat bot that integrates with Telegram, Discord, and Slack, allowing you to manage all your messaging platforms in one place. Receive updates, search conversations, and interact with your messaging history using natural language within OpenChat.

## Features

- **Multi-Platform Integration**: Connect your Telegram, Discord, and Slack accounts in one bot
- **Real-Time Notifications**: Receive message notifications from all platforms in OpenChat
- **Natural Language Queries**: Ask questions about your conversations and get relevant information
- **Message History**: Search and browse your message history across platforms
- **Channel Management**: Control which channels you want to track

## Getting Started

### Prerequisites

- An OpenChat account
- API credentials for the platforms you want to connect:
  - **Telegram**: API ID and API Hash from [my.telegram.org/apps](https://my.telegram.org/apps)
  - **Discord**: Bot token from [Discord Developer Portal](https://discord.com/developers/applications)
  - **Slack**: Bot token from [Slack API](https://api.slack.com/apps)

### Installation

1. Find MessengerHub in the OpenChat bot directory
2. Start a conversation with the bot
3. Follow the setup instructions for each platform you want to connect

## Usage

### Basic Commands

- `/help` - Show the help message
- `/setup <platform>` - Get setup instructions for a platform
- `/connect <platform> <credentials>` - Connect to a messaging platform
- `/status` - Check your connection status
- `/list <platform>` - List available channels/chats for a platform
- `/disconnect <platform>` - Disconnect from a platform

### Example Setup Commands

```
# Set up Telegram
/setup telegram
/connect telegram 123456 abcdef1234567890abcdef your_phone_number

# Set up Discord
/setup discord
/connect discord your.discord.bot.token.here

# Set up Slack
/setup slack
/connect slack xoxb-your-slack-token-here
```

### Asking Questions About Your Messages

You can use natural language to query your message history:

```
What did Jane say about the project yesterday in Slack?
Show me the last 5 messages from the #general Discord channel
Find all mentions of "quarterly report" in my Telegram groups
Summarize today's conversation in the Marketing Slack channel
```

## Privacy & Security

- All your credentials and message data are stored securely
- The bot only accesses the platforms and channels you explicitly connect
- You can disconnect any platform at any time using the `/disconnect` command
- Message history is stored for a limited time only

## Development

This bot is built using the OpenChat Bots SDK and integrates with the following APIs:
- Telegram API (via [telegram](https://github.com/gram-js/telegram) library)
- Discord API (via [discord.js](https://discord.js.org/))
- Slack API (via [@slack/web-api](https://slack.dev/node-slack-sdk/web-api) and [@slack/rtm-api](https://slack.dev/node-slack-sdk/rtm-api))

## Contributing

Contributions are welcome! Feel free to submit a pull request or open an issue to report bugs or request features.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
