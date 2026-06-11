const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const wordBank = {
  animal: [
    '老虎', '大象', '熊猫', '长颈鹿', '狮子', '斑马', '猴子', '狐狸', '狼', '熊',
    '兔子', '猫', '狗', '鱼', '鸟', '蛇', '青蛙', '蝴蝶', '蜜蜂', '蚂蚁',
    '鲨鱼', '鲸鱼', '海豚', '企鹅', '北极熊', '袋鼠', '考拉', '松鼠', '刺猬', '鳄鱼'
  ],
  job: [
    '医生', '老师', '警察', '消防员', '厨师', '司机', '程序员', '设计师', '画家', '歌手',
    '演员', '记者', '律师', '工程师', '科学家', '宇航员', '飞行员', '船长', '农民', '工人',
    '理发师', '牙医', '护士', '教练', '运动员', '舞蹈家', '作家', '摄影师', '魔术师', '侦探'
  ],
  movie: [
    '泰坦尼克号', '阿凡达', '复仇者联盟', '蜘蛛侠', '哈利波特', '指环王', '侏罗纪公园', '星际穿越', '盗梦空间', '无间道',
    '阿甘正传', '楚门的世界', '肖申克的救赎', '疯狂动物城', '寻梦环游记', '飞屋环游记', '哪吒之魔童降世', '流浪地球', '满江红', '封神',
    '西虹市首富', '夏洛特烦恼', '唐人街探案', '让子弹飞', '一代宗师', '卧虎藏龙', '花样年华', '春光乍泄', '重庆森林', '无间道'
  ]
};

const MAX_PLAYERS = 5;
const MAX_SPECTATORS = 10;
const ROUND_TIME = 80;
const HINT_COST = 5;

class GameServer {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  createRoom(hostId, hostName, category, rounds) {
    const roomCode = this.generateRoomCode();
    const room = {
      code: roomCode,
      hostId: hostId,
      category: category,
      totalRounds: rounds,
      currentRound: 0,
      currentDrawerIndex: 0,
      status: 'waiting',
      players: [],
      spectators: [],
      word: '',
      hints: [],
      roundStartTime: 0,
      roundTimer: null,
      gameLog: [],
      drawingData: []
    };
    this.rooms.set(roomCode, room);
    return roomCode;
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  addPlayer(roomCode, playerId, playerName, ws) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: '房间不存在' };

    if (room.players.length >= MAX_PLAYERS) {
      if (room.spectators.length >= MAX_SPECTATORS) {
        return { error: '房间已满' };
      }
      const spectator = { id: playerId, name: playerName, score: 0, ws: ws, isSpectator: true, disconnected: false };
      room.spectators.push(spectator);
      this.broadcastRoomState(roomCode);
      return { success: true, room, spectator, player: null };
    }

    const player = {
      id: playerId,
      name: playerName,
      score: 0,
      ws: ws,
      isSpectator: false,
      disconnected: false,
      lastGuess: null
    };
    room.players.push(player);
    this.broadcastRoomState(roomCode);
    return { success: true, room, player, spectator: null };
  }

  removePlayer(roomCode, playerId) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    let playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      room.players[playerIndex].disconnected = true;

      if (room.players[playerIndex].id === room.hostId) {
        this.transferHost(roomCode);
      }

      if (room.status === 'playing') {
        const currentDrawer = this.getCurrentDrawer(roomCode);
        if (currentDrawer && currentDrawer.id === playerId) {
          this.endRound(roomCode, 'drawer_disconnected');
        }
      }

      this.broadcastRoomState(roomCode);
      return;
    }

    let spectatorIndex = room.spectators.findIndex(s => s.id === playerId);
    if (spectatorIndex !== -1) {
      room.spectators.splice(spectatorIndex, 1);
      this.broadcastRoomState(roomCode);
    }
  }

  transferHost(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    const activePlayers = room.players.filter(p => !p.disconnected);
    if (activePlayers.length > 0) {
      room.hostId = activePlayers[0].id;
    }
  }

  getCurrentDrawer(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room || room.currentDrawerIndex >= room.players.length) return null;
    return room.players[room.currentDrawerIndex];
  }

  startGame(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: '房间不存在' };

    if (room.players.filter(p => !p.disconnected).length < 2) {
      return { error: '至少需要两名玩家才能开始游戏' };
    }

    room.status = 'playing';
    this.startNextRound(roomCode);
    return { success: true };
  }

  startNextRound(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    room.currentRound++;
    if (room.currentRound > room.totalRounds) {
      this.endGame(roomCode);
      return;
    }

    while (room.currentDrawerIndex < room.players.length) {
      const drawer = room.players[room.currentDrawerIndex];
      if (!drawer.disconnected) {
        break;
      }
      room.currentDrawerIndex++;
    }

    if (room.currentDrawerIndex >= room.players.length) {
      room.currentDrawerIndex = 0;
    }

    const words = wordBank[room.category];
    const randomWord = words[Math.floor(Math.random() * words.length)];
    room.word = randomWord;
    room.hints = [];
    room.drawingData = [];
    room.guessed = new Set();
    room.currentGuessCount = 0;

    this.logRound(roomCode);

    room.status = 'playing';
    room.roundStartTime = Date.now();
    this.broadcastRoomState(roomCode);

    const drawer = this.getCurrentDrawer(roomCode);
    if (drawer && !drawer.disconnected) {
      this.sendToPlayer(drawer, {
        type: 'your-turn',
        word: randomWord
      });
    }

    room.roundTimer = setTimeout(() => {
      this.endRound(roomCode, 'timeout');
    }, ROUND_TIME * 1000);
  }

  logRound(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    room.gameLog.push({
      round: room.currentRound,
      drawer: this.getCurrentDrawer(roomCode) ? this.getCurrentDrawer(roomCode).name : 'unknown',
      word: room.word,
      guessedBy: []
    });
  }

  addHint(roomCode, playerId) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: '房间不存在' };

    const drawer = this.getCurrentDrawer(roomCode);
    if (!drawer || drawer.id !== playerId) {
      return { error: '只有画家可以使用提示' };
    }

    if (drawer.score < HINT_COST) {
      return { error: '积分不足，需要5分才能获得提示' };
    }

    const availableChars = [];
    for (let i = 0; i < room.word.length; i++) {
      if (!room.hints.includes(i)) {
        availableChars.push(i);
      }
    }

    if (availableChars.length === 0) {
      return { error: '已经没有更多提示了' };
    }

    drawer.score -= HINT_COST;
    const randomIndex = availableChars[Math.floor(Math.random() * availableChars.length)];
    room.hints.push(randomIndex);

    this.broadcastRoomState(roomCode);
    return { success: true, hints: room.hints, word: room.word };
  }

  handleGuess(roomCode, guesserId, guessText) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: '房间不存在' };

    const guesser = room.players.find(p => p.id === guesserId);
    if (!guesser || guesser.isSpectator) {
      return { error: '只有玩家可以猜测' };
    }

    if (guesserId === this.getCurrentDrawer(roomCode).id) {
      return { error: '画家不能猜测' };
    }

    if (room.guessed.has(guesserId)) {
      return { error: '你已经猜中了' };
    }

    guessText = guessText.trim();
    const normalizedGuess = guessText.replace(/\s/g, '');
    const normalizedWord = room.word.replace(/\s/g, '');

    const isCorrect = normalizedGuess === normalizedWord;

    this.broadcastChat(roomCode, {
      playerName: guesser.name,
      message: guessText,
      isGuess: true,
      isCorrect: isCorrect
    }, guesserId);

    if (isCorrect) {
      const timeLeft = ROUND_TIME - Math.floor((Date.now() - room.roundStartTime) / 1000);
      const points = Math.max(5, Math.floor(timeLeft * 1.5));
      guesser.score += points;

      const drawer = this.getCurrentDrawer(roomCode);
      const assistPoints = Math.max(2, Math.floor(points / 2));
      if (drawer && !drawer.disconnected) {
        drawer.score += assistPoints;
      }

      room.guessed.add(guesserId);
      room.currentGuessCount++;

      const lastLog = room.gameLog[room.gameLog.length - 1];
      if (lastLog) {
        lastLog.guessedBy.push({ name: guesser.name, time: timeLeft, points: points });
      }

      if (room.guessed.size === room.players.filter(p => !p.disconnected && p.id !== drawer.id).length) {
        this.endRound(roomCode, 'all-guessed');
      } else {
        this.broadcastRoomState(roomCode);
      }

      return { correct: true, points: points };
    }

    return { correct: false };
  }

  endRound(roomCode, reason) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    room.status = 'round-end';
    room.currentDrawerIndex++;
    this.broadcastRoomState(roomCode);

    setTimeout(() => {
      this.startNextRound(roomCode);
    }, 5000);
  }

  endGame(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    room.status = 'game-end';

    let mvp = null;
    let maxScore = -1;
    room.players.forEach(player => {
      if (!player.disconnected && player.score > maxScore) {
        maxScore = player.score;
        mvp = player;
      }
    });

    this.broadcastToRoom(roomCode, {
      type: 'game-end',
      mvp: mvp ? { id: mvp.id, name: mvp.name, score: mvp.score } : null,
      log: room.gameLog
    });
  }

  broadcastChat(roomCode, message, excludeId) {
    this.broadcastToRoom(roomCode, {
      type: 'chat',
      data: message
    }, excludeId);
  }

  broadcastDrawing(roomCode, drawingData, excludeId) {
    const room = this.getRoom(roomCode);
    if (room) {
      room.drawingData.push(drawingData);
      this.broadcastToRoom(roomCode, {
        type: 'draw',
        data: drawingData
      }, excludeId);
    }
  }

  clearCanvas(roomCode, excludeId) {
    const room = this.getRoom(roomCode);
    if (room) {
      room.drawingData = [];
      this.broadcastToRoom(roomCode, {
        type: 'clear-canvas'
      }, excludeId);
    }
  }

  broadcastToRoom(roomCode, data, excludeId = null) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    const sendTo = (participant) => {
      if (!excludeId || participant.id !== excludeId) {
        this.sendToPlayer(participant, data);
      }
    };

    room.players.forEach(sendTo);
    room.spectators.forEach(sendTo);
  }

  sendToPlayer(player, data) {
    try {
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(data));
      }
    } catch (e) {
      console.error('发送失败:', e);
    }
  }

  broadcastRoomState(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    const state = this.getRoomState(roomCode);
    this.broadcastToRoom(roomCode, {
      type: 'room-state',
      data: state
    });
  }

  getRoomState(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const currentDrawer = this.getCurrentDrawer(roomCode);

    return {
      code: room.code,
      hostId: room.hostId,
      category: room.category,
      totalRounds: room.totalRounds,
      currentRound: room.currentRound,
      currentDrawerId: currentDrawer ? currentDrawer.id : null,
      currentDrawerName: currentDrawer ? currentDrawer.name : null,
      status: room.status,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        isSpectator: p.isSpectator,
        disconnected: p.disconnected
      })),
      spectators: room.spectators.length,
      wordLength: room.word ? room.word.length : 0,
      hints: room.hints,
      revealedWord: this.getRevealedWord(room),
      timeLeft: this.getTimeLeft(roomCode),
      drawingData: room.drawingData
    };
  }

  getRevealedWord(room) {
    if (!room.word) return '';
    if (room.status === 'round-end' || room.status === 'game-end') {
      return room.word;
    }
    let revealed = '';
    for (let i = 0; i < room.word.length; i++) {
      revealed += room.hints.includes(i) ? room.word[i] : '_';
    }
    return revealed;
  }

  getTimeLeft(roomCode) {
    const room = this.getRoom(roomCode);
    if (room.status !== 'playing' || !room.roundStartTime) return 0;
    const elapsed = Math.floor((Date.now() - room.roundStartTime) / 1000);
    return Math.max(0, ROUND_TIME - elapsed);
  }

  exportGameLog(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const log = {
      roomCode: room.code,
      category: room.category,
      totalRounds: room.totalRounds,
      endedAt: new Date().toISOString(),
      players: room.players.map(p => ({ id: p.id, name: p.name, finalScore: p.score })),
      rounds: room.gameLog
    };

    return log;
  }

  cleanupInactiveRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const allDisconnected = [...room.players, ...room.spectators].every(p => p.disconnected);
      if (allDisconnected) {
        this.rooms.delete(code);
      }
    }
  }

  reconnectPlayer(roomCode, playerId, newWs) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: '房间不存在' };

    let player = room.players.find(p => p.id === playerId);
    if (player) {
      player.ws = newWs;
      player.disconnected = false;
      this.broadcastRoomState(roomCode);
      this.sendToPlayer(player, {
        type: 'reconnected',
        state: this.getRoomState(roomCode)
      });
      return { success: true, isSpectator: false };
    }

    let spectator = room.spectators.find(s => s.id === playerId);
    if (spectator) {
      spectator.ws = newWs;
      spectator.disconnected = false;
      this.broadcastRoomState(roomCode);
      this.sendToPlayer(spectator, {
        type: 'reconnected',
        state: this.getRoomState(roomCode)
      });
      return { success: true, isSpectator: true };
    }

    return { error: '找不到玩家信息' };
  }
}

const gameServer = new GameServer();

const server = http.createServer((req, res) => {
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpeg';
      break;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if(error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'create-room':
          const playerId = message.playerId;
          const playerName = message.playerName || '玩家' + playerId.substring(0, 4);
          const category = message.category || 'animal';
          const rounds = message.rounds || 5;
          const roomCode = gameServer.createRoom(playerId, playerName, category, rounds);
          const result = gameServer.addPlayer(roomCode, playerId, playerName, ws);
          currentRoomCode = roomCode;
          currentPlayerId = playerId;
          ws.send(JSON.stringify({
            type: 'room-created',
            code: roomCode,
            state: gameServer.getRoomState(roomCode)
          }));
          break;

        case 'join-room':
          const joinCode = message.roomCode.toUpperCase();
          const joinPlayerId = message.playerId;
          const joinPlayerName = message.playerName || '玩家' + joinPlayerId.substring(0, 4);
          const joinResult = gameServer.addPlayer(joinCode, joinPlayerId, joinPlayerName, ws);
          if (joinResult.success) {
            currentRoomCode = joinCode;
            currentPlayerId = joinPlayerId;
            ws.send(JSON.stringify({
              type: 'room-joined',
              code: joinCode,
              isSpectator: !!joinResult.spectator,
              state: gameServer.getRoomState(joinCode)
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: joinResult.error
            }));
          }
          break;

        case 'reconnect':
          if (message.roomCode && message.playerId) {
            const recResult = gameServer.reconnectPlayer(message.roomCode.toUpperCase(), message.playerId, ws);
            if (recResult.success) {
              currentRoomCode = message.roomCode.toUpperCase();
              currentPlayerId = message.playerId;
              ws.send(JSON.stringify({
                type: 'reconnected',
                isSpectator: recResult.isSpectator,
                state: recResult.state
              }));
            } else {
              ws.send(JSON.stringify({
                type: 'error',
                message: recResult.error
              }));
            }
          }
          break;

        case 'start-game':
          const startResult = gameServer.startGame(currentRoomCode);
          if (!startResult.success) {
            ws.send(JSON.stringify({
              type: 'error',
              message: startResult.error
            }));
          }
          break;

        case 'guess':
          const guessResult = gameServer.handleGuess(currentRoomCode, currentPlayerId, message.text);
          if (guessResult.error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: guessResult.error
            }));
          }
          break;

        case 'draw':
          gameServer.broadcastDrawing(currentRoomCode, message.data, currentPlayerId);
          break;

        case 'clear-canvas':
          gameServer.clearCanvas(currentRoomCode, currentPlayerId);
          break;

        case 'get-hint':
          const hintResult = gameServer.addHint(currentRoomCode, currentPlayerId);
          if (hintResult.error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: hintResult.error
            }));
          }
          break;

        case 'chat':
          gameServer.broadcastChat(currentRoomCode, {
            playerName: message.playerName,
            message: message.text,
            isGuess: false
          }, currentPlayerId);
          break;

        case 'export-log':
          const log = gameServer.exportGameLog(currentRoomCode);
          ws.send(JSON.stringify({
            type: 'game-log',
            log: log
          }));
          break;

        default:
          console.log('未知消息类型:', message.type);
      }
    } catch (e) {
      console.error('消息处理错误:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoomCode && currentPlayerId) {
      setTimeout(() => {
        const room = gameServer.getRoom(currentRoomCode);
        if (room) {
          const player = room.players.find(p => p.id === currentPlayerId) || room.spectators.find(s => s.id === currentPlayerId);
          if (player && (!player.ws || player.ws === ws)) {
            gameServer.removePlayer(currentRoomCode, currentPlayerId);
          }
        }
      }, 10000);
    }
  });
});

setInterval(() => {
  gameServer.cleanupInactiveRooms();
}, 60000);

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
