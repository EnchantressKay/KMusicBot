# YouTube Discord Bot

A powerful Discord bot built with Node.js that plays and searches YouTube videos in voice channels with queue support.

## Features
- **YouTube Search**: Search for songs directly by name.
- **Queue System**: Add multiple songs to a queue.
- **Skip Support**: Skip the current track to the next one in queue.
- **Per-Server Management**: Separate queues for different Discord servers.

## Prerequisites

1.  **Node.js**: Ensure you have Node.js 20+ installed.
2.  **Discord Bot Token**: Create a bot on the [Discord Developer Portal](https://discord.com/developers/applications).
    *   Enable **Message Content Intent**, **Server Members Intent**, and **Presence Intent** in the "Bot" section.
    *   Give the bot permissions to join and speak in voice channels.

## Setup

1.  Clone this repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
4.  Fill in your `DISCORD_TOKEN` in the `.env` file.

## Usage

1.  Run the bot:
    ```bash
    node index.js
    ```
2.  In Discord, join a voice channel.
3.  Use the following commands:
    *   `!play <URL or Search Terms>`: Searches and plays the audio. Adds to queue if something is already playing.
    *   `!skip`: Skips the current song.
    *   `!queue`: Shows the current list of songs in the queue.
    *   `!stop`: Stops playback and clears the queue.
    *   `!leave`: Makes the bot leave the voice channel.

## Dependencies

-   `discord.js`: To interact with the Discord API.
-   `@discordjs/voice`: For voice channel support.
-   `play-dl`: To fetch, search, and stream YouTube audio.
-   `dotenv`: To manage environment variables.
