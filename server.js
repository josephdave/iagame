const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Load configuration
const gameConfig = JSON.parse(fs.readFileSync('./config/game-config.json', 'utf8'));
const itemsConfig = JSON.parse(fs.readFileSync('./config/items.json', 'utf8'));

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Game state
let gameState = {
  status: 'waiting', // waiting, active, finished
  nextGameTime: null,
  players: new Map(),
  teams: [],
  qrItems: new Map(),
  timeRemaining: 0,
  startTime: null,
  confirmedPlayers: new Set(),
  confirmationDeadline: null
};

// Initialize QR-Item mapping
function initializeQRItems() {
  const allItems = [...itemsConfig.items, ...itemsConfig.penalty_items];
  const qrCodes = gameConfig.game.qr_codes;
  
  // Shuffle items and assign to QR codes
  const shuffledItems = [...allItems].sort(() => Math.random() - 0.5);
  
  gameState.qrItems.clear();
  qrCodes.forEach((qrCode, index) => {
    const item = shuffledItems[index % shuffledItems.length];
    gameState.qrItems.set(qrCode, {
      ...item,
      isPenalty: itemsConfig.penalty_items.some(p => p.nombre === item.nombre)
    });
  });
}

// Team assignment logic with equitable distribution
function assignTeams(confirmedPlayers = null) {
  // Use confirmed players or all players if no confirmations
  const playersToAssign = confirmedPlayers || Array.from(gameState.players.values());
  const teamCount = Math.min(gameConfig.game.max_teams, Math.max(2, Math.ceil(playersToAssign.length / 4)));
  
  console.log(`Assigning ${playersToAssign.length} players to ${teamCount} teams`);
  
  // Shuffle players for randomness
  const shuffledPlayers = [...playersToAssign].sort(() => Math.random() - 0.5);
  
  // Initialize teams
  gameState.teams = [];
  for (let i = 0; i < teamCount; i++) {
    const team = gameConfig.game.team_colors[i];
    gameState.teams.push({
      id: i,
      name: team.name,
      color: team.color,
      players: [],
      items: [],
      requiredItems: [],
      penalizedPlayers: new Set()
    });
  }
  
  // Distribute players equitably (one by one to each team)
  shuffledPlayers.forEach((player, index) => {
    const teamIndex = index % teamCount;
    gameState.teams[teamIndex].players.push(player);
    player.teamId = teamIndex;
    console.log(`Assigned player ${player.name} to team ${gameState.teams[teamIndex].name}`);
  });
  
  // Log final team distribution
  gameState.teams.forEach(team => {
    console.log(`Team ${team.name}: ${team.players.length} players - ${team.players.map(p => p.name).join(', ')}`);
  });
  
  // Assign items to teams
  const availableItems = [...itemsConfig.items];
  gameState.teams.forEach(team => {
    const shuffledItems = [...availableItems].sort(() => Math.random() - 0.5);
    team.requiredItems = shuffledItems.slice(0, gameConfig.game.items_per_team);
  });
}

// Webhook notification
async function sendWebhookNotification(message) {
  if (gameConfig.game.webhook_url && gameConfig.game.webhook_url !== 'https://example.com/webhook') {
    try {
      await axios.post(gameConfig.game.webhook_url, { message });
    } catch (error) {
      console.error('Webhook error:', error.message);
    }
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/controles', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controles.html'));
});

app.get('/scan/:qrId', (req, res) => {
  const qrId = req.params.qrId;
  // Don't check player registration here, let the client handle it
  // This allows for localStorage-based identification
  res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

app.post('/api/set-next-game', (req, res) => {
  const { datetime } = req.body;
  gameState.nextGameTime = new Date(datetime);
  gameState.status = 'waiting';
  
  io.emit('gameScheduled', {
    nextGameTime: gameState.nextGameTime,
    countdown: Math.max(0, gameState.nextGameTime - Date.now())
  });
  
  res.json({ success: true, nextGameTime: gameState.nextGameTime });
});

app.get('/api/game-state', (req, res) => {
  res.json({
    status: gameState.status,
    nextGameTime: gameState.nextGameTime,
    timeRemaining: gameState.timeRemaining,
    teams: gameState.teams.map(team => ({
      id: team.id,
      name: team.name,
      color: team.color,
      players: team.players.map(p => p.name),
      items: team.items,
      requiredItems: team.requiredItems,
      penalizedPlayers: Array.from(team.penalizedPlayers)
    }))
  });
});

app.get('/api/qr-item/:qrId', (req, res) => {
  const qrId = req.params.qrId;
  const item = gameState.qrItems.get(qrId);
  
  if (!item) {
    return res.status(404).json({ error: 'QR code not found' });
  }
  
  res.json(item);
});

// Socket.IO events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('registerPlayer', (data) => {
    const { name } = data;
    const playerId = uuidv4();
    
    const player = {
      id: playerId,
      name: name,
      socketId: socket.id,
      teamId: null,
      items: [],
      isPenalized: false
    };
    
    gameState.players.set(playerId, player);
    socket.playerId = playerId;
    
    // Only show confirmation if we're waiting for a game AND in confirmation period
    const isInConfirmationPeriod = gameState.status === 'waiting' && gameState.confirmationDeadline !== null;
    
    socket.emit('playerRegistered', {
      playerId: playerId,
      name: name,
      gameState: {
        status: gameState.status,
        nextGameTime: gameState.nextGameTime,
        timeRemaining: gameState.timeRemaining
      },
      requiresConfirmation: isInConfirmationPeriod,
      confirmationDeadline: gameState.confirmationDeadline
    });
    
    console.log(`Player registered: ${name} (${playerId})`);
  });
  
  socket.on('reconnectPlayer', (data) => {
    const { playerId, playerName } = data;
    
    console.log(`Reconnection attempt - PlayerID: ${playerId}, Name: ${playerName}, Socket: ${socket.id}`);
    
    if (playerId && gameState.players.has(playerId)) {
      const player = gameState.players.get(playerId);
      player.socketId = socket.id;
      socket.playerId = playerId;
      
      console.log(`Player reconnected successfully: ${playerName} (${playerId})`);
      
      // Only show confirmation if we're waiting for a game AND in confirmation period
      const isInConfirmationPeriod = gameState.status === 'waiting' && gameState.confirmationDeadline !== null;
      
      // Send current game state
      socket.emit('playerReconnected', {
        playerId: playerId,
        name: playerName,
        gameState: {
          status: gameState.status,
          nextGameTime: gameState.nextGameTime,
          timeRemaining: gameState.timeRemaining,
          teams: gameState.teams.map(team => ({
            id: team.id,
            name: team.name,
            color: team.color,
            players: team.players.map(p => p.name),
            items: team.items,
            requiredItems: team.requiredItems,
            penalizedPlayers: Array.from(team.penalizedPlayers)
          }))
        },
        requiresConfirmation: isInConfirmationPeriod,
        confirmationDeadline: gameState.confirmationDeadline
      });
    } else {
      console.log(`Reconnection failed - Player not found. PlayerID: ${playerId}, Available players: ${Array.from(gameState.players.keys())}`);
      socket.emit('playerNotFound', { 
        message: 'Player not found on server, please register again',
        reason: 'server_restart_or_expired'
      });
    }
  });
  
  socket.on('scanQR', async (data) => {
    const { qrId } = data;
    const playerId = socket.playerId;
    
    console.log(`Scan QR attempt - QR: ${qrId}, PlayerID: ${playerId}, Socket: ${socket.id}`);
    
    if (!playerId || !gameState.players.has(playerId)) {
      console.log(`Scan failed - Player not found. PlayerID: ${playerId}, Players: ${Array.from(gameState.players.keys())}`);
      return socket.emit('playerNotFound', { 
        message: 'Player not found on server, please register again',
        reason: 'server_restart_or_expired'
      });
    }
    
    if (gameState.status !== 'active') {
      return socket.emit('error', { message: 'Game is not active' });
    }
    
    const player = gameState.players.get(playerId);
    const item = gameState.qrItems.get(qrId);
    
    if (!item) {
      return socket.emit('error', { message: 'Invalid QR code' });
    }
    
    if (player.isPenalized) {
      return socket.emit('error', { message: 'Player is penalized and cannot collect items' });
    }
    
    const team = gameState.teams[player.teamId];
    
    if (item.isPenalty) {
      player.isPenalized = true;
      team.penalizedPlayers.add(player.name);
      
      const message = `${player.name} del equipo ${team.name} ha sido penalizado con ${item.nombre}`;
      await sendWebhookNotification(message);
      
      socket.emit('itemScanned', {
        item: item,
        isPenalty: true,
        message: 'Has sido penalizado y no puedes recolectar más items'
      });
    } else {
      const isRequired = team.requiredItems.some(req => req.nombre === item.nombre);
      const alreadyHas = team.items.some(collected => collected.nombre === item.nombre);
      
      if (isRequired && !alreadyHas) {
        team.items.push(item);
        
        const message = `${player.name} del equipo ${team.name} ha encontrado el item ${item.nombre}`;
        await sendWebhookNotification(message);
        
        socket.emit('itemScanned', {
          item: item,
          isPenalty: false,
          isRequired: true,
          message: `¡Excelente! Has encontrado ${item.nombre} para tu equipo`
        });
        
        // Check if team completed all items
        if (team.items.length === team.requiredItems.length) {
          gameState.status = 'finished';
          const winMessage = `¡El equipo ${team.name} ha ganado completando todos los items!`;
          await sendWebhookNotification(winMessage);
          
          io.emit('gameFinished', {
            winner: team,
            reason: 'completed_all_items'
          });
        }
      } else {
        socket.emit('itemScanned', {
          item: item,
          isPenalty: false,
          isRequired: false,
          message: alreadyHas ? 'Tu equipo ya tiene este item' : 'Este item no está en la lista de tu equipo'
        });
      }
    }
    
    // Broadcast updated game state
    io.emit('gameStateUpdate', {
      teams: gameState.teams.map(team => ({
        id: team.id,
        name: team.name,
        color: team.color,
        players: team.players.map(p => p.name),
        items: team.items,
        requiredItems: team.requiredItems,
        penalizedPlayers: Array.from(team.penalizedPlayers)
      })),
      timeRemaining: gameState.timeRemaining
    });
  });
  
  socket.on('confirmParticipation', (data) => {
    const { playerId, playerName } = data;
    
    console.log(`Player ${playerName} (${playerId}) confirmed participation`);
    
    if (playerId && gameState.players.has(playerId)) {
      gameState.confirmedPlayers.add(playerId);
      
      // Notify all clients about the confirmation
      io.emit('playerConfirmed', {
        playerId,
        playerName,
        confirmedCount: gameState.confirmedPlayers.size,
        totalPlayers: gameState.players.size
      });
      
      console.log(`Confirmed players: ${gameState.confirmedPlayers.size}/${gameState.players.size}`);
    } else {
      socket.emit('error', { message: 'Player not found' });
    }
  });
  
  socket.on('declineParticipation', (data) => {
    const { playerId, playerName } = data;
    
    console.log(`Player ${playerName} (${playerId}) declined participation`);
    
    if (playerId && gameState.players.has(playerId)) {
      // Remove from confirmed players if they were confirmed
      gameState.confirmedPlayers.delete(playerId);
      
      // Notify all clients about the decline
      io.emit('playerDeclined', {
        playerId,
        playerName,
        confirmedCount: gameState.confirmedPlayers.size,
        totalPlayers: gameState.players.size
      });
      
      console.log(`Player declined. Confirmed players: ${gameState.confirmedPlayers.size}/${gameState.players.size}`);
    } else {
      socket.emit('error', { message: 'Player not found' });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.playerId) {
      const player = gameState.players.get(socket.playerId);
      if (player) {
        // Don't remove player, just mark as disconnected
        player.socketId = null;
        console.log(`Player ${player.name} disconnected but remains in game`);
      }
    }
  });
});

// Game timer
function startGameTimer() {
  gameState.timeRemaining = gameConfig.game.duration_minutes * 60 * 1000;
  gameState.startTime = Date.now();
  
  const timer = setInterval(() => {
    gameState.timeRemaining = Math.max(0, gameState.timeRemaining - 1000);
    
    io.emit('timeUpdate', { timeRemaining: gameState.timeRemaining });
    
    if (gameState.timeRemaining <= 0) {
      clearInterval(timer);
      endGame();
    }
  }, 1000);
}

async function endGame() {
  gameState.status = 'finished';
  
  // Check if there are teams to find a winner
  let winner = null;
  let winMessage = '¡El juego ha terminado!';
  
  if (gameState.teams && gameState.teams.length > 0) {
    // Find winner (team with most items)
    winner = gameState.teams.reduce((best, team) => 
      team.items.length > best.items.length ? team : best
    );
    
    winMessage = `¡El juego ha terminado! El equipo ${winner.name} ha ganado con ${winner.items.length} items recolectados`;
  } else {
    winMessage = '¡El juego ha terminado! No había equipos activos.';
    // Create a dummy winner for the client
    winner = {
      id: 0,
      name: 'Sin equipos',
      color: '#666666',
      items: [],
      players: []
    };
  }
  
  await sendWebhookNotification(winMessage);
  
  io.emit('gameFinished', {
    winner: winner,
    reason: 'time_up',
    finalScores: gameState.teams ? gameState.teams.map(team => ({
      name: team.name,
      items: team.items.length,
      required: team.requiredItems.length
    })) : []
  });
  
  // Reset game state to allow new game scheduling
  setTimeout(() => {
    gameState.status = 'waiting';
    gameState.nextGameTime = null;
    gameState.teams = [];
    gameState.timeRemaining = 0;
    gameState.startTime = null;
    gameState.confirmedPlayers.clear();
    gameState.confirmationDeadline = null;
    
    // Reset players team assignments but keep them registered
    gameState.players.forEach(player => {
      player.teamId = null;
      player.items = [];
      player.isPenalized = false;
    });
    
    console.log('Game state reset after game end');
    io.emit('gameStateReset');
  }, 5000); // 5 second delay to show final results
}

// Game scheduler
function checkGameStart() {
  if (gameState.status === 'waiting' && gameState.nextGameTime) {
    const now = Date.now();
    const gameTime = gameState.nextGameTime.getTime();
    const confirmationPeriod = 60000; // 1 minute for confirmation
    
    // Show confirmation screen 1 minute before game start
    if (now >= gameTime - confirmationPeriod && now < gameTime) {
      if (!gameState.confirmationDeadline) {
        startConfirmationPeriod();
      }
    }
    
    // Start game when time is reached and confirmations are collected
    if (now >= gameTime) {
      if (gameState.confirmationDeadline) {
        startGameWithConfirmedPlayers();
      } else {
        startGame();
      }
    }
  }
}

function startConfirmationPeriod() {
  console.log('Starting confirmation period...');
  
  gameState.confirmationDeadline = new Date(gameState.nextGameTime.getTime());
  gameState.confirmedPlayers.clear();
  
  io.emit('confirmationRequired', {
    deadline: gameState.confirmationDeadline,
    timeRemaining: gameState.nextGameTime.getTime() - Date.now()
  });
  
  console.log(`Confirmation period started. Players have until ${gameState.confirmationDeadline} to confirm.`);
}

async function startGameWithConfirmedPlayers() {
  console.log('Starting game with confirmed players...');
  
  // Get confirmed players
  const confirmedPlayersList = Array.from(gameState.confirmedPlayers)
    .map(playerId => gameState.players.get(playerId))
    .filter(player => player); // Filter out any null/undefined players
  
  console.log(`Confirmed players: ${confirmedPlayersList.length}/${gameState.players.size}`);
  confirmedPlayersList.forEach(player => console.log(`- ${player.name}`));
  
  if (confirmedPlayersList.length < 2) {
    console.log('Not enough confirmed players to start game');
    await sendWebhookNotification('El juego se canceló - no hay suficientes jugadores confirmados');
    
    // Reset confirmation state
    gameState.confirmationDeadline = null;
    gameState.confirmedPlayers.clear();
    
    io.emit('gameAborted', {
      reason: 'insufficient_confirmations',
      message: 'No hay suficientes jugadores confirmados para iniciar el juego'
    });
    return;
  }
  
  gameState.status = 'active';
  initializeQRItems();
  assignTeams(confirmedPlayersList); // Pass confirmed players to team assignment
  startGameTimer();
  
  await sendWebhookNotification(`¡El juego ha comenzado con ${confirmedPlayersList.length} jugadores confirmados!`);
  
  io.emit('gameStarted', {
    teams: gameState.teams.map(team => ({
      id: team.id,
      name: team.name,
      color: team.color,
      players: team.players.map(p => p.name),
      items: team.items,
      requiredItems: team.requiredItems,
      penalizedPlayers: Array.from(team.penalizedPlayers)
    })),
    timeRemaining: gameState.timeRemaining
  });
}

async function startGame() {
  console.log('Starting game...');
  
  gameState.status = 'active';
  initializeQRItems();
  assignTeams();
  startGameTimer();
  
  await sendWebhookNotification('¡El juego ha comenzado!');
  
  io.emit('gameStarted', {
    teams: gameState.teams.map(team => ({
      id: team.id,
      name: team.name,
      color: team.color,
      players: team.players.map(p => p.name),
      items: team.items,
      requiredItems: team.requiredItems,
      penalizedPlayers: Array.from(team.penalizedPlayers)
    })),
    timeRemaining: gameState.timeRemaining
  });
}

// Check for game start every second
setInterval(checkGameStart, 1000);

// QR Code generation endpoint
app.get('/api/players', (req, res) => {
  const playersList = Array.from(gameState.players.values()).map(player => ({
    id: player.id,
    name: player.name,
    teamId: player.teamId,
    isPenalized: player.isPenalized
  }));
  res.json(playersList);
});

app.get('/api/validate-player/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  
  if (gameState.players.has(playerId)) {
    const player = gameState.players.get(playerId);
    res.json({ 
      valid: true, 
      player: {
        id: player.id,
        name: player.name,
        teamId: player.teamId,
        isPenalized: player.isPenalized
      }
    });
  } else {
    res.json({ 
      valid: false, 
      message: 'Player not found on server'
    });
  }
});

app.post('/api/start-game-now', async (req, res) => {
  if (gameState.status === 'active') {
    return res.json({ success: false, message: 'Game is already active' });
  }
  
  if (gameState.players.size < 2) {
    return res.json({ success: false, message: 'At least 2 players required' });
  }
  
  try {
    await startGame();
    res.json({ success: true });
  } catch (error) {
    console.error('Error starting game:', error);
    res.json({ success: false, message: 'Failed to start game' });
  }
});

app.post('/api/end-game', async (req, res) => {
  if (gameState.status !== 'active') {
    return res.json({ success: false, message: 'No active game to end' });
  }
  
  try {
    await endGame();
    res.json({ success: true });
  } catch (error) {
    console.error('Error ending game:', error);
    res.json({ success: false, message: 'Failed to end game' });
  }
});

app.post('/api/reset-game', (req, res) => {
  try {
    // Reset game state
    gameState.status = 'waiting';
    gameState.nextGameTime = null;
    gameState.teams = [];
    gameState.timeRemaining = 0;
    gameState.startTime = null;
    gameState.confirmedPlayers.clear();
    gameState.confirmationDeadline = null;
    
    // Reset players team assignments
    gameState.players.forEach(player => {
      player.teamId = null;
      player.items = [];
      player.isPenalized = false;
    });
    
    // Reinitialize QR items
    initializeQRItems();
    
    io.emit('gameReset');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting game:', error);
    res.json({ success: false, message: 'Failed to reset game' });
  }
});

app.post('/api/clear-players', (req, res) => {
  if (gameState.status === 'active') {
    return res.json({ success: false, message: 'Cannot clear players during active game' });
  }
  
  try {
    gameState.players.clear();
    gameState.teams = [];
    
    io.emit('playersCleared');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing players:', error);
    res.json({ success: false, message: 'Failed to clear players' });
  }
});

app.get('/api/generate-qr/:qrId', async (req, res) => {
  const qrId = req.params.qrId;
  const url = `${req.protocol}://${req.get('host')}/scan/${qrId}`;
  
  try {
    const qrCode = await QRCode.toDataURL(url);
    res.json({ qrCode, url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});