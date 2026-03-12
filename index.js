require('dotenv').config();
const path = require('path');
const ffmpegStatic = require('ffmpeg-static');
process.env.FFMPEG_PATH = path.isAbsolute(ffmpegStatic) ? ffmpegStatic : path.join(__dirname, ffmpegStatic);
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    getVoiceConnection,
    VoiceConnectionStatus,
    StreamType
} = require('@discordjs/voice');
const { execSync, spawn } = require('child_process');
const play = require('play-dl');

const ytDlpPath = path.join(__dirname, 'yt-dlp');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Map to store guild-specific queues and players
const queues = new Map();
// Map to store guild-specific volume settings (default 0.1)
const guildVolumes = new Map();

function deleteQueue(guildId) {
    const queueData = queues.get(guildId);
    if (queueData) {
        if (queueData.idleTimeout) {
            clearTimeout(queueData.idleTimeout);
        }
        queueData.player.stop();
        // The connection might already be destroyed, but if not, destroy it
        try {
            if (queueData.connection.state.status !== VoiceConnectionStatus.Destroyed) {
                queueData.connection.destroy();
            }
        } catch (error) {
            console.error('Error destroying connection during cleanup:', error);
        }
        queues.delete(guildId);
    }
}

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    console.log(`Currently serving ${client.guilds.cache.size} servers:`);
    client.guilds.cache.forEach(guild => {
        console.log(` - ${guild.name} (${guild.id})`);
    });
});

async function playNext(guildId) {
    const queueData = queues.get(guildId);
    if (!queueData) return;

    if (queueData.songs.length === 0) {
        return;
    }

    const song = queueData.songs[0];
    console.log(`Attempting to play song: ${song.title}`);
    
    try {
        const ytDlpProcess = spawn(ytDlpPath, [
            '-o', '-',
            '-f', 'bestaudio',
            '--no-playlist',
            '--js-runtimes', 'node',
            song.url
        ]);

        ytDlpProcess.on('error', err => {
            console.error('yt-dlp spawn error:', err);
            queueData.textChannel.send(`❌ Failed to start audio downloader for **${song.title}**.`);
        });

        const resource = createAudioResource(ytDlpProcess.stdout, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        const volume = guildVolumes.get(guildId) ?? 0.1;
        resource.volume.setVolume(volume);

        queueData.player.play(resource);
        queueData.textChannel.send(`🎶 Now playing: **${song.title}**`);
    } catch (error) {
        console.error(error);
        queueData.textChannel.send(`❌ Error playing **${song.title}**, skipping to next...`);
        queueData.songs.shift();
        playNext(guildId);
    }
}

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    if (command === '!play') {
        const query = args.slice(1).join(' ');

        if (!query) {
            return message.reply('Please provide a YouTube URL or search terms!');
        }

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('You need to be in a voice channel to play music!');
        }

        let songInfo;
        try {
            const validation = play.yt_validate(query);
            // Check if it's a direct URL or search query
            if (validation === 'video') {
                const info = await play.video_info(query);
                songInfo = {
                    title: info.video_details.title,
                    url: info.video_details.url,
                    duration: info.video_details.durationRaw
                };
            } else if (validation === 'playlist') {
                return message.reply('❌ Playlists are not supported yet. Please provide a single video URL or search term.');
            } else {
                const results = await play.search(query, { limit: 1 });
                if (results.length === 0) return message.reply('No results found.');
                songInfo = {
                    title: results[0].title,
                    url: results[0].url,
                    duration: results[0].durationRaw
                };
            }

            if (!songInfo || !songInfo.url) {
                return message.reply('❌ Could not find a valid URL for this song.');
            }

            let queueData = queues.get(message.guildId);

            if (queueData && queueData.connection.state.status === VoiceConnectionStatus.Destroyed) {
                deleteQueue(message.guildId);
                queueData = null;
            }

            if (!queueData) {
                const player = createAudioPlayer();
                
                player.on(AudioPlayerStatus.Idle, () => {
                    const q = queues.get(message.guildId);
                    if (q) {
                        q.songs.shift(); // Remove the finished song
                        if (q.songs.length > 0) {
                            playNext(message.guildId);
                        } else {
                            // If queue is empty, set a timeout to leave after 5 minutes
                            q.idleTimeout = setTimeout(() => {
                                const currentQ = queues.get(message.guildId);
                                if (currentQ && currentQ.songs.length === 0) {
                                    deleteQueue(message.guildId);
                                    currentQ.textChannel.send('👋 Left the voice channel due to inactivity.');
                                }
                            }, 300000); // 5 minutes
                        }
                    }
                });

                player.on('error', error => {
                    console.error(`Error: ${error.message}`);
                });

                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });

                connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
                    try {
                        // Wait for a short moment to see if it's a temporary disconnect or a kick
                        await Promise.race([
                            new Promise(resolve => setTimeout(resolve, 5000)),
                            new Promise(resolve => {
                                connection.once(VoiceConnectionStatus.Ready, resolve);
                            })
                        ]);

                        if (connection.state.status !== VoiceConnectionStatus.Ready) {
                            deleteQueue(message.guild.id);
                        }
                    } catch (e) {
                        deleteQueue(message.guild.id);
                    }
                });

                connection.on(VoiceConnectionStatus.Destroyed, () => {
                    deleteQueue(message.guild.id);
                });

                connection.subscribe(player);

                queueData = {
                    textChannel: message.channel,
                    voiceChannel: voiceChannel,
                    connection: connection,
                    player: player,
                    songs: [],
                    idleTimeout: null,
                };
                queues.set(message.guildId, queueData);
            }

            // Clear inactivity timeout if a new song is added
            if (queueData.idleTimeout) {
                clearTimeout(queueData.idleTimeout);
                queueData.idleTimeout = null;
            }

            queueData.songs.push(songInfo);

            if (queueData.songs.length === 1) {
                playNext(message.guildId);
            } else {
                message.reply(`✅ Added **${songInfo.title}** to the queue!`);
            }

        } catch (error) {
            console.error(error);
            message.reply('There was an error processing your request.');
        }
    }

    if (command === '!help') {
        const embed = new EmbedBuilder()
            .setTitle('KMusicBot Help')
            .setDescription('Here are the available commands:')
            .addFields(
                { name: '!play <url/search>', value: 'Plays a song from YouTube.' },
                { name: '!pause', value: 'Pauses the currently playing song.' },
                { name: '!resume', value: 'Resumes the paused song.' },
                { name: '!skip', value: 'Skips the current song.' },
                { name: '!volume <0-100>', value: 'Sets the volume (default is 10%).' },
                { name: '!queue', value: 'Shows the current song queue.' },
                { name: '!stop', value: 'Stops playback and clears the queue.' },
                { name: '!leave', value: 'Makes the bot leave the voice channel.' },
                { name: '!help', value: 'Shows this help message.' }
            )
            .setColor('#ff0000');

        message.channel.send({ embeds: [embed] });
    }

    if (command === '!volume') {
        const volumeArg = args[1];
        if (!volumeArg) {
            const currentVolume = (guildVolumes.get(message.guildId) ?? 0.1) * 100;
            return message.reply(`🔊 Current volume is **${currentVolume}%**.`);
        }

        const newVolumePercent = parseInt(volumeArg);
        if (isNaN(newVolumePercent) || newVolumePercent < 0 || newVolumePercent > 100) {
            return message.reply('❌ Please provide a volume level between 0 and 100.');
        }

        const newVolume = newVolumePercent / 100;
        guildVolumes.set(message.guildId, newVolume);

        const queueData = queues.get(message.guildId);
        if (queueData && queueData.player.state.status === AudioPlayerStatus.Playing) {
            // Update currently playing volume if possible
            // Note: In @discordjs/voice, we need to update the resource volume if it exists
            const resource = queueData.player.state.resource;
            if (resource && resource.volume) {
                resource.volume.setVolume(newVolume);
            }
        }

        message.reply(`🔊 Volume set to **${newVolumePercent}%**.`);
    }

    if (command === '!pause') {
        const queueData = queues.get(message.guildId);
        if (!queueData) return message.reply('Nothing is playing right now.');
        
        if (queueData.player.state.status === AudioPlayerStatus.Paused) {
            return message.reply('The player is already paused!');
        }

        queueData.player.pause();
        message.reply('⏸️ Paused!');
    }

    if (command === '!resume') {
        const queueData = queues.get(message.guildId);
        if (!queueData) return message.reply('Nothing is playing right now.');
        
        if (queueData.player.state.status !== AudioPlayerStatus.Paused) {
            return message.reply('The player is not paused!');
        }

        queueData.player.unpause();
        message.reply('▶️ Resumed!');
    }

    if (command === '!skip') {
        const queueData = queues.get(message.guildId);
        if (!queueData) return message.reply('Nothing is playing right now.');
        
        queueData.player.stop();
        message.reply('⏭️ Skipped!');
    }

    if (command === '!queue') {
        const queueData = queues.get(message.guildId);
        if (!queueData || queueData.songs.length === 0) {
            return message.reply('The queue is currently empty.');
        }

        const embed = new EmbedBuilder()
            .setTitle('Current Queue')
            .setDescription(
                queueData.songs
                    .map((song, index) => `${index + 1}. **${song.title}** (${song.duration})`)
                    .join('\n')
            )
            .setColor('#ff0000');

        message.channel.send({ embeds: [embed] });
    }

    if (command === '!stop') {
        const queueData = queues.get(message.guildId);
        if (queueData) {
            queueData.songs = [];
            queueData.player.stop();
            message.reply('🛑 Playback stopped and queue cleared.');
        }
    }

    if (command === '!leave') {
        const connection = getVoiceConnection(message.guildId);
        if (connection) {
            deleteQueue(message.guildId);
            message.reply('👋 Left the voice channel.');
        } else {
            message.reply('I am not in a voice channel!');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
