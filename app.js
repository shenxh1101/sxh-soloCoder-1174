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
  let countdownTimer = null;
  let localTimeLeft = 0;
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
    stopCountdown();
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

    if (gameState && gameState.status === 'game-end') {
      addSystemMessage('对局日志已下载，正在打开复盘...');
      openReplay(log);
    } else {
      addSystemMessage('对局日志已保存（游戏结束后可复盘）');
    }
  }

  function openReplay(log) {
    stopCountdown();
    document.getElementById('gameOverModal').classList.remove('active');
    showModal('replayModal');
    loadReplayLog(log);
  }

  function openReplayFromFile(log) {
    showModal('replayModal');
    loadReplayLog(log);
  }

  function validateReplayLog(log) {
    if (!log || typeof log !== 'object') return false;
    if (log.game !== 'draw-and-guess') return false;
    if (!Array.isArray(log.rounds)) return false;
    if (!Array.isArray(log.players)) return false;
    if (typeof log.roomCode !== 'string' || log.roomCode.length === 0) return false;
    for (var i = 0; i < log.rounds.length; i++) {
      var r = log.rounds[i];
      if (typeof r.round !== 'number' || typeof r.word !== 'string' || typeof r.drawer !== 'string') return false;
      if (!Array.isArray(r.guessedBy)) return false;
    }
    return true;
  }

  function loadReplayLog(log) {
    if (!validateReplayLog(log)) {
      alert('文件格式不正确，请选择有效的"你画我猜"对局日志 JSON 文件');
      document.getElementById('replayModal').classList.remove('active');
      return;
    }

    var canvas = document.getElementById('replayCanvas');
    var ctx = canvas.getContext('2d');
    var container = canvas.parentElement;
    var size = Math.min(container.clientWidth - 8, container.clientHeight - 8, 600);
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    document.getElementById('replayRoomCode').textContent = log.roomCode || '--';
    document.getElementById('replayCategory').textContent = log.category || '--';
    document.getElementById('replayRounds').textContent = (log.rounds ? log.rounds.length : 0) + ' / ' + (log.totalRounds || 0);

    var roundSelect = document.getElementById('replayRoundSelect');
    roundSelect.innerHTML = '';

    if (log.rounds && log.rounds.length > 0) {
      log.rounds.forEach(function(round, idx) {
        var option = document.createElement('option');
        option.value = idx;
        option.textContent = '第' + round.round + '回合 - ' + round.drawer;
        roundSelect.appendChild(option);
      });
    }

    window._replayLog = log;
    window._replayCanvas = canvas;
    window._replayCtx = ctx;
    window._replayTimer = null;
    window._replayStep = 0;
    window._replayTotalSteps = 0;

    if (log.rounds && log.rounds.length > 0) {
      loadReplayRound(0);
    }
  }

  function loadReplayRound(idx) {
    var log = window._replayLog;
    if (!log || !log.rounds || idx >= log.rounds.length) return;

    var round = log.rounds[idx];
    var canvas = window._replayCanvas;
    var ctx = window._replayCtx;

    if (window._replayTimer) {
      clearInterval(window._replayTimer);
      window._replayTimer = null;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var info = document.getElementById('replayRoundInfo');
    var details = '<h3>第' + round.round + '回合</h3>';
    details += '<p>画家: ' + escapeHtml(round.drawer) + ' | 谜底: ' + escapeHtml(round.word) + '</p>';
    details += '<h3>分数变化</h3>';
    if (round.guessedBy && round.guessedBy.length > 0) {
      round.guessedBy.forEach(function(g) {
        details += '<div class="score-row"><span>' + escapeHtml(g.name) + ' 猜中</span><span class="score-value">+' + g.points + ' 分</span></div>';
      });
      var drawerPoints = Math.max(2, Math.floor(round.guessedBy[0].points / 2));
      details += '<div class="score-row"><span>' + escapeHtml(round.drawer) + ' 助攻</span><span class="score-value">+' + drawerPoints + ' 分</span></div>';
    } else {
      details += '<div class="score-row"><span>无人猜中</span><span class="score-value">+0</span></div>';
    }
    if (log.players) {
      details += '<h3>当前总分</h3>';
      log.players.forEach(function(p) {
        details += '<div class="score-row"><span>' + escapeHtml(p.name) + '</span><span class="score-value">' + p.finalScore + ' 分</span></div>';
      });
    }
    info.innerHTML = details;

    var drawingData = round.drawingData || [];
    window._replayStep = 0;
    window._replayTotalSteps = drawingData.length;

    document.getElementById('replayProgress').textContent = '';

    document.getElementById('replayPlayBtn').disabled = drawingData.length === 0;
    document.getElementById('replayStopBtn').disabled = true;

    if (drawingData.length === 0) {
      document.getElementById('replayProgress').textContent = '无绘图数据';
    }
  }

  function playReplay() {
    var log = window._replayLog;
    if (!log) return;

    var idx = parseInt(document.getElementById('replayRoundSelect').value);
    var round = log.rounds[idx];
    var drawingData = round.drawingData || [];

    if (drawingData.length === 0) {
      document.getElementById('replayProgress').textContent = '无绘图数据';
      return;
    }

    var canvas = window._replayCanvas;
    var ctx = window._replayCtx;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    document.getElementById('replayPlayBtn').disabled = true;
    document.getElementById('replayStopBtn').disabled = false;

    window._replayStep = 0;
    window._replayTotalSteps = drawingData.length;

    var stepInterval = Math.max(15, Math.floor(80000 / drawingData.length));

    window._replayTimer = setInterval(function() {
      if (window._replayStep >= drawingData.length) {
        clearInterval(window._replayTimer);
        window._replayTimer = null;
        document.getElementById('replayPlayBtn').disabled = false;
        document.getElementById('replayStopBtn').disabled = true;
        document.getElementById('replayProgress').textContent = '回放完成';
        return;
      }

      var batchEnd = Math.min(window._replayStep + 2, drawingData.length);
      for (var i = window._replayStep; i < batchEnd; i++) {
        var d = drawingData[i];
        if (d.type === 'clear') {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          continue;
        }
        ctx.strokeStyle = d.color;
        ctx.lineWidth = d.width;
        ctx.globalCompositeOperation = d.tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.beginPath();
        ctx.moveTo(d.prevX, d.prevY);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      window._replayStep = batchEnd;

      var pct = Math.min(100, Math.floor(window._replayStep / window._replayTotalSteps * 100));
      document.getElementById('replayProgress').textContent = pct + '%';
    }, stepInterval);
  }

  function stopReplay() {
    if (window._replayTimer) {
      clearInterval(window._replayTimer);
      window._replayTimer = null;
    }
    document.getElementById('replayPlayBtn').disabled = false;
    document.getElementById('replayStopBtn').disabled = true;
  }

  function handleFileReplay(event) {
    var file = event.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var log = JSON.parse(e.target.result);
        if (!validateReplayLog(log)) {
          alert('文件格式不正确，请选择有效的"你画我猜"对局日志 JSON 文件');
          return;
        }
        openReplayFromFile(log);
      } catch (err) {
        alert('文件格式不正确，无法解析 JSON');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function renderRoundHistory(gameLog) {
    var container = document.getElementById('roundHistoryList');
    if (!container) return;
    container.innerHTML = '';

    if (!gameLog || gameLog.length === 0) {
      container.innerHTML = '<div class="history-empty">暂无已结束回合</div>';
      return;
    }

    var baseScores = {};
    if (gameState && gameState.players) {
      gameState.players.forEach(function(p) {
        baseScores[p.name] = p.score;
      });
    }

    gameLog.forEach(function(round, idx) {
      var div = document.createElement('div');
      div.className = 'history-item';
      div.setAttribute('data-round', idx);

      var header = document.createElement('div');
      header.className = 'history-item-header';
      header.textContent = '第' + round.round + '回合 - 画家: ' + round.drawer;
      div.appendChild(header);

      var word = document.createElement('div');
      word.className = 'history-item-word';
      word.textContent = '谜底: ' + round.word;
      div.appendChild(word);

      var changes = document.createElement('div');
      changes.className = 'history-item-changes';
      var changeText = [];

      if (round.guessedBy && round.guessedBy.length > 0) {
        round.guessedBy.forEach(function(g) {
          changeText.push(g.name + ' +' + g.points + '分');
          if (changeText.length % 2 === 0) {
            changeText.push('\n');
          }
        });
        var drawerPoints = round.guessedBy[0].points / 2;
        changeText.push(round.drawer + ' +' + Math.max(2, Math.floor(drawerPoints)) + '分（助攻）');
      } else {
        changeText.push('无人猜中，无人加分');
      }

      changes.textContent = changeText.join(' · ');
      div.appendChild(changes);

      if (round.guessedBy && round.guessedBy.length > 0) {
        var guessers = document.createElement('div');
        guessers.className = 'history-item-guessers';
        guessers.textContent = '猜中: ' + round.guessedBy.map(function(g) { return g.name + '(' + g.points + '分)'; }).join(', ');
        div.appendChild(guessers);
      } else {
        var noGuess = document.createElement('div');
        noGuess.className = 'history-item-guessers';
        noGuess.textContent = '无人猜中';
        div.appendChild(noGuess);
      }

      div.addEventListener('click', function() {
        var currentRoomLog = {
          game: 'draw-and-guess',
          version: '1.0',
          roomCode: roomCode,
          category: gameState ? gameState.category : '',
          totalRounds: gameState ? gameState.totalRounds : 0,
          players: gameState ? gameState.players.map(function(p) { return { id: p.id, name: p.name, finalScore: p.score }; }) : [],
          rounds: gameLog
        };
        openReplayFromFile(currentRoomLog);
        document.getElementById('replayRoundSelect').value = idx;
        loadReplayRound(idx);
      });

      container.appendChild(div);
    });
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
      localTimeLeft = state.timeLeft;
      startCountdown();
    } else if (state.status === 'round-end') {
      stopCountdown();
      timer.textContent = '结束';
      timer.classList.remove('urgent');
    } else if (state.status === 'game-end') {
      stopCountdown();
      timer.textContent = '--:--';
      timer.classList.remove('urgent');
    } else {
      stopCountdown();
      timer.textContent = '--:--';
      timer.classList.remove('urgent');
    }

    if (state.status === 'playing' && state.currentDrawerId === playerId) {
      isDrawer = true;
    } else {
      isDrawer = false;
    }

    if (state.status === 'playing' && isDrawer && currentWord) {
      document.getElementById('toolbar').classList.remove('disabled');
      canvas.classList.remove('disabled');
      document.getElementById('hintBtn').disabled = false;
      document.getElementById('chatInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
    } else if (state.status === 'playing' && isDrawer && !currentWord) {
      document.getElementById('toolbar').classList.add('disabled');
      canvas.classList.add('disabled');
      document.getElementById('hintBtn').disabled = true;
      document.getElementById('chatInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
    } else if (state.status === 'playing' && !isDrawer) {
      document.getElementById('toolbar').classList.add('disabled');
      canvas.classList.add('disabled');
      document.getElementById('hintBtn').disabled = true;
      document.getElementById('chatInput').disabled = false;
      document.getElementById('sendBtn').disabled = false;
    } else if (state.status === 'round-end' || state.status === 'game-end') {
      document.getElementById('toolbar').classList.add('disabled');
      canvas.classList.add('disabled');
      document.getElementById('hintBtn').disabled = true;
      document.getElementById('chatInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
    } else {
      document.getElementById('toolbar').classList.add('disabled');
      canvas.classList.add('disabled');
      document.getElementById('hintBtn').disabled = true;
      document.getElementById('chatInput').disabled = true;
      document.getElementById('sendBtn').disabled = true;
    }

    if (state.status === 'round-end') {
      currentWord = '';
      addSystemMessage('回合结束！谜底是：' + (state.revealedWord || '未知'));
    }

    if (state.drawingData && state.drawingData.length > 0 && !isDrawer) {
      replayDrawingData(state.drawingData);
    }

    if (state.gameLog) {
      var completedRounds = state.gameLog.filter(function(log) {
        return log.drawingData !== undefined;
      });
      renderRoundHistory(completedRounds);
    }
  }

  function replayDrawingData(data) {
    if (!canvasInit) return;
    handleClearCanvas();
    if (!data || data.length === 0) return;
    data.forEach(function(d) {
      if (d.type === 'clear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
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
    stopCountdown();
    document.getElementById('gameRoom').classList.remove('active');
    document.getElementById('gameOverModal').classList.remove('active');
    document.getElementById('replayModal').classList.remove('active');
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

  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(function() {
      localTimeLeft--;
      updateTimerDisplay();
      if (localTimeLeft <= 0) {
        stopCountdown();
      }
    }, 1000);
    updateTimerDisplay();
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function updateTimerDisplay() {
    var mins = Math.floor(Math.max(0, localTimeLeft) / 60);
    var secs = Math.max(0, localTimeLeft) % 60;
    var display = mins + ':' + (secs < 10 ? '0' : '') + secs;
    document.getElementById('timer').textContent = display;
    if (localTimeLeft <= 15 && localTimeLeft > 0) {
      document.getElementById('timer').classList.add('urgent');
    } else {
      document.getElementById('timer').classList.remove('urgent');
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

  document.getElementById('replayPlayBtn').addEventListener('click', function() {
    playReplay();
  });

  document.getElementById('replayStopBtn').addEventListener('click', function() {
    stopReplay();
  });

  document.getElementById('replayRoundSelect').addEventListener('change', function() {
    stopReplay();
    loadReplayRound(parseInt(this.value));
  });

  document.getElementById('replayBackBtn').addEventListener('click', function() {
    stopReplay();
    document.getElementById('replayModal').classList.remove('active');
  });

  document.getElementById('replayFileInput').addEventListener('change', function(event) {
    handleFileReplay(event);
  });

  connect();
})();