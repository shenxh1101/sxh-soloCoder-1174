(function() {
  const WS_URL = 'ws://' + window.location.host;
  let ws = null;
  let playerId = '';
  let playerName = '';
  let roomCode = '';
  let isSpectator = false;
  let isHost = false;
  let isDrawer = false;
  let currentWord = '';
  let gameState = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let currentTool = 'pen';
  let penColor = '#000000';
  let penSize = 5;
  let lastX = 0;
  let lastY = 0;
  let canvasInit = false;

  function initCanvas() {
    const container = canvas.parentElement;
    const size = Math.min(container.clientWidth - 8, container.clientHeight - 8, 700);
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    canvasInit = true;
  }

  function generateId() {
    return 'player_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
  }

  function loadSavedId() {
    let id = localStorage.getItem('drawGuess_playerId');
    if (!id) {
      id = generateId();
      localStorage.setItem('drawGuess_playerId', id);
    }
    return id;
  }

  function saveRoomInfo(code, pId) {
    localStorage.setItem('drawGuess_roomCode', code);
    localStorage.setItem('drawGuess_playerId', pId);
  }

  function clearRoomInfo() {
    localStorage.removeItem('drawGuess_roomCode');
  }

  function getSavedRoomInfo() {
    return {
      roomCode: localStorage.getItem('drawGuess_roomCode'),
      playerId: localStorage.getItem('drawGuess_playerId')
    };
  }

  playerId = loadSavedId();

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = function() {
      console.log('WebSocket 已连接');
      document.getElementById('reconnectOverlay').classList.remove('active');
      reconnectAttempts = 0;

      const saved = getSavedRoomInfo();
      if (saved.roomCode && saved.playerId && !roomCode) {
        ws.send(JSON.stringify({
          type: 'reconnect',
          roomCode: saved.roomCode,
          playerId: saved.playerId
        }));
      }
    };

    ws.onmessage = function(event) {
      const message = JSON.parse(event.data);
      handleMessage(message);
    };

    ws.onclose = function() {
      console.log('WebSocket 断开连接');
      attemptReconnect();
    };

    ws.onerror = function(err) {
      console.error('WebSocket 错误:', err);
    };
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
      document.getElementById('reconnectOverlay').classList.remove('active');
      alert('无法重新连接，请刷新页面重试。');
      return;
    }

    reconnectAttempts++;
    document.getElementById('reconnectOverlay').classList.add('active');

    reconnectTimer = setTimeout(function() {
      connect();
    }, 2000 * reconnectAttempts);
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'room-created':
        handleRoomCreated(message);
        break;
      case 'room-joined':
        handleRoomJoined(message);
        break;
      case 'reconnected':
        handleReconnected(message);
        break;
      case 'room-state':
        handleRoomState(message.data);
        break;
      case 'draw':
        handleDraw(message.data);
        break;
      case 'clear-canvas':
        handleClearCanvas();
        break;
      case 'chat':
        handleChat(message.data);
        break;
      case 'your-turn':
        handleYourTurn(message.word);
        break;
      case 'game-end':
        handleGameEnd(message);
        break;
      case 'game-log':
        handleGameLog(message.log);
        break;
      case 'error':
        handleError(message.message);
        break;
    }
  }

  function handleRoomCreated(message) {
    roomCode = message.code;
    saveRoomInfo(roomCode, playerId);
    isHost = true;
    showGameRoom();
    updateRoomState(message.state);
  }

  function handleRoomJoined(message) {
    roomCode = message.code;
    saveRoomInfo(roomCode, playerId);
    isHost = false;
    isSpectator = message.isSpectator;
    showGameRoom();
    updateRoomState(message.state);
    if (isSpectator) {
      addSystemMessage('你以观战者身份加入房间');
    }
  }

  function handleReconnected(message) {
    isSpectator = message.isSpectator || false;
    if (message.state) {
      roomCode = message.state.code;
      isHost = message.state.hostId === playerId;
      showGameRoom();
      updateRoomState(message.state);
      addSystemMessage('已重新连接');
    }
  }

  function handleRoomState(state) {
    gameState = state;
    updateRoomState(state);
  }

  function handleDraw(data) {
    if (!canvasInit) return;
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.width;
    ctx.globalCompositeOperation = data.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(data.prevX, data.prevY);
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function handleClearCanvas() {
    if (!canvasInit) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function handleChat(data) {
    addChatMessage(data.playerName, data.message, data.isGuess, data.isCorrect);
  }

  function handleYourTurn(word) {
    currentWord = word;
    isDrawer = true;
    document.getElementById('drawerWord').textContent = word;
    document.getElementById('hintBtn').disabled = false;
    canvas.classList.remove('disabled');
    document.getElementById('toolbar').classList.remove('disabled');
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    addSystemMessage('轮到你了！请绘制：' + word);
  }

  function handleGameEnd(message) {
    isDrawer = false;
    showModal('gameOverModal');

    const mvpDisplay = document.getElementById('mvpDisplay');
    if (message.mvp) {
      mvpDisplay.innerHTML = '<h3>🏆 本场 MVP</h3><p>' + message.mvp.name + '</p><p class="mvp-score">' + message.mvp.score + ' 分</p>';
    } else {
      mvpDisplay.innerHTML = '<h3>🏆 本场 MVP</h3><p>无</p>';
    }

    const finalScores = document.getElementById('finalScores');
    let scoresHtml = '<h3>📊 最终得分</h3>';
    if (gameState && gameState.players) {
      gameState.players.sort(function(a, b) { return b.score - a.score; });
      gameState.players.forEach(function(p) {
        scoresHtml += '<div class="score-row"><span>' + (p.disconnected ? '🔴 ' : '') + p.name + '</span><span class="score-value">' + p.score + ' 分</span></div>';
      });
    }
    finalScores.innerHTML = scoresHtml;

    const roundSummary = document.getElementById('roundSummary');
    let summaryHtml = '<h3>📋 回合回顾</h3>';
    if (message.log) {
      message.log.forEach(function(round) {
        summaryHtml += '<div class="round-item"><div class="round-header">第' + round.round + '回合 - 画家: ' + round.drawer + ' | 谜底: ' + escapeHtml(round.word) + '</div>';
        if (round.guessedBy && round.guessedBy.length > 0) {
          summaryHtml += '<div class="guessers">猜中者: ' + round.guessedBy.map(function(g) { return g.name + '(' + g.points + '分)'; }).join(', ') + '</div>';
        } else {
          summaryHtml += '<div class="guessers">无人猜中</div>';
        }
        summaryHtml += '</div>';
      });
    }
    roundSummary.innerHTML = summaryHtml;
  }

  function handleGameLog(log) {
    const json = JSON.stringify(log, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'game-log-' + (log.roomCode || 'unknown') + '-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    addSystemMessage('对局日志已保存');
  }

  function handleError(message) {
    alert(message);
  }

  function updateRoomState(state) {
    if (!state) return;

    document.getElementById('displayRoomCode').textContent = state.code;
    document.getElementById('displayTotalRounds').textContent = state.totalRounds;
    document.getElementById('displayRound').textContent = state.currentRound;

    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    if (state.players) {
      state.players.forEach(function(p) {
        const li = document.createElement('li');
        if (p.id === state.currentDrawerId) {
          li.classList.add('current-drawer');
        }
        if (p.disconnected) {
          li.classList.add('disconnected');
        }
        li.innerHTML = '<span>' + (p.id === state.hostId ? '👑 ' : '') + (p.disconnected ? '🔴 ' : '') + p.name + '</span><span class="player-score">' + p.score + '</span>';
        playerList.appendChild(li);
      });
    }

    const playerCount = state.players ? state.players.filter(function(p) { return !p.disconnected; }).length : 0;
    document.getElementById('playerCount').textContent = playerCount;

    const startBtn = document.getElementById('startGameBtn');
    const waitingArea = document.getElementById('waitingArea');

    if (state.status === 'waiting') {
      waitingArea.style.display = 'flex';
      if (isHost && playerId === state.hostId && state.players && state.players.length >= 2) {
        startBtn.style.display = 'inline-block';
      } else {
        startBtn.style.display = 'none';
      }
    } else {
      waitingArea.style.display = 'none';
    }

    const wordDisplay = document.getElementById('currentWord');
    if (state.revealedWord) {
      if (state.status === 'round-end' || state.status === 'game-end') {
        wordDisplay.textContent = state.revealedWord;
        wordDisplay.style.color = 'var(--danger)';
      } else {
        wordDisplay.textContent = state.wordLength ? '_'.repeat(state.wordLength).split('').map(function(c, i) {
          return state.hints && state.hints.includes(i) ? state.revealedWord[i] : '_';
        }).join(' ') : '';
        wordDisplay.style.color = 'var(--secondary)';
      }
    }

    const timer = document.getElementById('timer');
    if (state.timeLeft > 0 && state.status === 'playing') {
      const mins = Math.floor(state.timeLeft / 60);
      const secs = state.timeLeft % 60;
      timer.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
      if (state.timeLeft <= 15) {
        timer.classList.add('urgent');
      } else {
        timer.classList.remove('urgent');
      }
    } else if (state.status === 'round-end') {
      timer.textContent = '结束';
      timer.classList.remove('urgent');
    } else if (state.status === 'game-end') {
      timer.textContent = '--:--';
      timer.classList.remove('urgent');
    } else {
      timer.textContent = '--:--';
      timer.classList.remove('urgent');
    }

    if (state.status === 'playing' && state.currentDrawerId === playerId) {
      isDrawer = true;
    } else if (state.status !== 'playing') {
      isDrawer = false;
    }

    if (state.status === 'playing' && isDrawer) {
      document.getElementById('toolbar').classList.remove('disabled');
      canvas.classList.remove('disabled');
      document.getElementById('chatInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
    } else if (state.status === 'playing' && !isDrawer) {
      document.getElementById('toolbar').classList.add('disabled');
      canvas.classList.add('disabled');
      document.getElementById('chatInput').disabled = false;
      document.getElementById('sendBtn').disabled = false;
    } else if (state.status === 'round-end' || state.status === 'game-end') {
      document.getElementById('toolbar').classList.add('disabled');
      canvas.classList.add('disabled');
      document.getElementById('chatInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
    }

    if (state.status === 'round-end') {
      addSystemMessage('回合结束！谜底是：' + (state.revealedWord || '未知'));
    }

    if (state.drawingData && state.drawingData.length > 0 && !isDrawer) {
      replayDrawingData(state.drawingData);
    }
  }

  function replayDrawingData(data) {
    if (!canvasInit) return;
    handleClearCanvas();
    data.forEach(function(d) {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = d.width;
      ctx.globalCompositeOperation = d.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(d.prevX, d.prevY);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  function showGameRoom() {
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('gameRoom').classList.add('active');
    if (!canvasInit) {
      initCanvas();
    }
  }

  function showLobby() {
    document.getElementById('gameRoom').classList.remove('active');
    document.getElementById('gameOverModal').classList.remove('active');
    document.getElementById('lobby').classList.add('active');
    roomCode = '';
    isHost = false;
    isSpectator = false;
    isDrawer = false;
    currentWord = '';
    gameState = null;
    clearRoomInfo();
  }

  function showModal(id) {
    document.getElementById(id).classList.add('active');
  }

  function hideModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  function addChatMessage(sender, text, isGuess, isCorrect) {
    const messages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.classList.add('chat-message');
    if (isGuess && isCorrect) {
      div.classList.add('guess-correct');
    }
    div.innerHTML = '<span class="sender">' + escapeHtml(sender) + '：</span>' + escapeHtml(text);
    if (isGuess && isCorrect) {
      div.innerHTML += ' ✅';
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function addSystemMessage(text) {
    const messages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.classList.add('chat-message', 'system-message');
    div.textContent = '📢 ' + text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sendMessage(type, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(Object.assign({ type: type }, data)));
    }
  }

  canvas.addEventListener('mousedown', function(e) {
    if (!isDrawer) return;
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
    lastY = (e.clientY - rect.top) * (canvas.height / rect.height);
  });

  canvas.addEventListener('mousemove', function(e) {
    if (!isDrawing || !isDrawer) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    ctx.strokeStyle = currentTool === 'eraser' ? '#ffffff' : penColor;
    ctx.lineWidth = penSize;
    ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    sendMessage('draw', {
      data: {
        x: x, y: y,
        prevX: lastX, prevY: lastY,
        color: currentTool === 'eraser' ? '#ffffff' : penColor,
        width: penSize,
        tool: currentTool
      }
    });

    lastX = x;
    lastY = y;
  });

  canvas.addEventListener('mouseup', function() {
    isDrawing = false;
  });

  canvas.addEventListener('mouseleave', function() {
    isDrawing = false;
  });

  canvas.addEventListener('touchstart', function(e) {
    if (!isDrawer) return;
    e.preventDefault();
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = (e.touches[0].clientX - rect.left) * (canvas.width / rect.width);
    lastY = (e.touches[0].clientY - rect.top) * (canvas.height / rect.height);
  });

  canvas.addEventListener('touchmove', function(e) {
    if (!isDrawing || !isDrawer) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches[0].clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.touches[0].clientY - rect.top) * (canvas.height / rect.height);

    ctx.strokeStyle = currentTool === 'eraser' ? '#ffffff' : penColor;
    ctx.lineWidth = penSize;
    ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    sendMessage('draw', {
      data: {
        x: x, y: y,
        prevX: lastX, prevY: lastY,
        color: currentTool === 'eraser' ? '#ffffff' : penColor,
        width: penSize,
        tool: currentTool
      }
    });

    lastX = x;
    lastY = y;
  });

  canvas.addEventListener('touchend', function() {
    isDrawing = false;
  });

  document.getElementById('createBtn').addEventListener('click', function() {
    const name = document.getElementById('playerName').value.trim();
    if (!name) {
      alert('请输入昵称');
      return;
    }
    playerName = name;
    sendMessage('create-room', {
      playerId: playerId,
      playerName: playerName,
      category: document.getElementById('category').value,
      rounds: parseInt(document.getElementById('rounds').value)
    });
  });

  document.getElementById('joinBtn').addEventListener('click', function() {
    const name = document.getElementById('playerName').value.trim();
    const code = document.getElementById('roomCode').value.trim().toUpperCase();
    if (!name) {
      alert('请输入昵称');
      return;
    }
    if (!code) {
      alert('请输入房间码');
      return;
    }
    playerName = name;
    sendMessage('join-room', {
      playerId: playerId,
      playerName: playerName,
      roomCode: code
    });
  });

  document.getElementById('startGameBtn').addEventListener('click', function() {
    sendMessage('start-game', {});
  });

  document.getElementById('sendBtn').addEventListener('click', function() {
    sendGuess();
  });

  document.getElementById('chatInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      sendGuess();
    }
  });

  function sendGuess() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    if (gameState && gameState.status === 'playing' && !isDrawer) {
      sendMessage('guess', { text: text });
    } else {
      sendMessage('chat', { playerName: playerName, text: text });
    }
  }

  document.getElementById('colorPicker').addEventListener('change', function() {
    penColor = this.value;
    currentTool = 'pen';
    document.getElementById('eraserBtn').classList.remove('active');
  });

  document.getElementById('brushSize').addEventListener('input', function() {
    penSize = parseInt(this.value);
    document.getElementById('brushSizeValue').textContent = this.value;
  });

  document.getElementById('eraserBtn').addEventListener('click', function() {
    if (currentTool === 'eraser') {
      currentTool = 'pen';
      this.classList.remove('active');
    } else {
      currentTool = 'eraser';
      this.classList.add('active');
    }
  });

  document.getElementById('clearBtn').addEventListener('click', function() {
    if (!isDrawer) return;
    handleClearCanvas();
    sendMessage('clear-canvas', {});
  });

  document.getElementById('hintBtn').addEventListener('click', function() {
    if (!isDrawer) return;
    sendMessage('get-hint', {});
  });

  document.getElementById('exportLogBtn').addEventListener('click', function() {
    sendMessage('export-log', {});
  });

  document.getElementById('backToLobbyBtn').addEventListener('click', function() {
    hideModal('gameOverModal');
    showLobby();
  });

  window.addEventListener('resize', function() {
    if (canvasInit) {
      initCanvas();
    }
  });

  var savedRoom = getSavedRoomInfo();
  if (savedRoom.roomCode) {
    playerId = savedRoom.playerId;
    document.getElementById('playerName').value = localStorage.getItem('drawGuess_playerName') || '';
  }

  document.getElementById('playerName').addEventListener('input', function() {
    localStorage.setItem('drawGuess_playerName', this.value);
  });

  connect();
})();