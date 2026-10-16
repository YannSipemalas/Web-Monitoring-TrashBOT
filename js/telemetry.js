/**
 * Real-Time Robot Telemetry State & Bin Capacity Management
 * Clean Production Receiver - Connected directly to Physical Robot Hardware Telemetry.
 */

window.RobotTelemetry = (function () {
  // Real Initial Hardware State (Clean - No Dummy Data)
  const state = {
    // Robot Hardware Status
    connected: true,
    cameraConnected: true,
    operationState: 'STANDBY', // 'STANDBY', 'NAVIGATING', 'SORTING', 'PAUSED', 'ALERT'
    
    // Position & Path Planning (Live Telemetry Coordinates from Robot)
    posX: 9.50,
    posY: 0.60,
    currentCP: 'START',
    nextCP: 'CP1',
    distanceToNext: 0.0, // in meters
    etaSeconds: 0,       // in seconds
    missionProgressPct: 0,

    // Checkpoint Nodes (Arena Map Reference)
    checkpoints: [
      { id: 'START', label: 'START', x: 9.5, y: 0.6, isStart: true },
      { id: 'CP1', label: 'CP1', x: 8.8, y: 0.6 },
      { id: 'CP2', label: 'CP2', x: 0.7, y: 0.6 },
      { id: 'CP3', label: 'CP3', x: 0.7, y: 5.4 },
      { id: 'CP4', label: 'CP4', x: 8.8, y: 5.4 }
    ],

    // Live Battery & Sensor Data
    batteryPct: 0,
    batteryVoltage: 0.0,
    batteryStatus: 'Normal',

    // Bin Capacities - Clean 0 Counts (Real Hardware Tracking)
    bins: {
      plastic: { name: 'Botol Plastik', count: 0, max: 50, status: 'Normal' },
      paper: { name: 'Kertas', count: 0, max: 50, status: 'Normal' },
      can: { name: 'Kaleng', count: 0, max: 50, status: 'Normal' },
      unknown: { name: 'Unknown', count: 0, max: 50, status: 'Normal' }
    },

    // Real Hardware Detection Event Log (Empty on boot)
    detectionLog: [],

    // Alert Messages Inbox System (Empty on boot)
    alertHistory: [],
    unreadAlertsCount: 0,

    // Hardware Connectivity Settings
    soundAlertsEnabled: true,
    hardwareApiUrl: '/api/telemetry'
  };

  const listeners = [];

  function subscribe(fn) {
    listeners.push(fn);
  }

  function notify() {
    listeners.forEach(fn => fn(state));
  }

  // Update bin capacity status automatically
  function evaluateBinStatus(binKey) {
    const bin = state.bins[binKey];
    if (!bin) return;

    const pct = (bin.count / bin.max) * 100;
    const oldStatus = bin.status;

    if (pct >= 100) {
      bin.status = 'Penuh';
    } else if (pct >= 80) {
      bin.status = 'Hampir Penuh';
    } else {
      bin.status = 'Normal';
    }

    if (oldStatus !== bin.status) {
      if (bin.status === 'Penuh') {
        triggerAlert('danger', `Tempat Sampah ${bin.name} Penuh!`, `Kapasitas: ${bin.count} / ${bin.max}`);
        playBeepSound(880, 0.4);
      } else if (bin.status === 'Hampir Penuh' && oldStatus === 'Normal') {
        triggerAlert('warning', `Tempat Sampah ${bin.name} Hampir Penuh`, `Kapasitas: ${bin.count} / ${bin.max}`);
        playBeepSound(587, 0.2);
      }
    }
  }

  // Record a real detected trash item from physical robot camera/sensors
  function addTrashItem(category, itemName, confidence = 95.0, itemSize = 'Sedang') {
    const keyMap = {
      'Plastik': 'plastic',
      'plastic': 'plastic',
      'Kertas': 'paper',
      'paper': 'paper',
      'Kaleng': 'can',
      'can': 'can',
      'Unknown': 'unknown',
      'unknown': 'unknown'
    };

    const binKey = keyMap[category] || 'unknown';
    const bin = state.bins[binKey];

    if (bin) {
      bin.count = Math.min(bin.count + 1, bin.max);
      evaluateBinStatus(binKey);
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    state.detectionLog.unshift({
      id: Date.now(),
      time: timeStr,
      name: itemName || `${bin ? bin.name : 'Objek'}`,
      category: binKey,
      size: itemSize || 'Sedang',
      confidence: parseFloat(confidence.toFixed(1))
    });

    if (state.detectionLog.length > 50) {
      state.detectionLog.pop();
    }

    notify();

    // Persist to Server database
    try {
      const targetUrl = window.location.protocol.startsWith('http')
        ? '/api/add-detection'
        : 'http://localhost:8080/api/add-detection';

      fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: binKey,
          itemName: itemName || (bin ? bin.name : 'Objek'),
          size: itemSize || 'Sedang',
          confidence: confidence
        })
      }).catch(e => console.warn('Persist detection API error:', e));
    } catch (e) {}
  }

  // Update State directly from Hardware Telemetry Payload (ESP32 / ROS / Raspberry Pi)
  function updateFromHardware(payload) {
    if (!payload) return;

    state.connected = payload.connected !== undefined ? payload.connected : true;
    state.cameraConnected = payload.cameraConnected !== undefined ? payload.cameraConnected : state.connected;

    const prevOpState = state.operationState;

    if (!state.connected) {
      state.batteryVoltage = 0.0;
      state.batteryPct = 0;
      state.operationState = 'OFFLINE';
    } else if (payload.operationState) {
      state.operationState = payload.operationState;
    }

    // Handle Obstacle State Event Alert
    if (state.operationState === 'STOPPED_OBSTACLE' && prevOpState !== 'STOPPED_OBSTACLE') {
      triggerAlert('warning', '🚨 ROBOT TERHENTI - ADA HALANGAN!', `Sensor mendeteksi objek penghalang pada jarak ${payload.obstacleDistanceCm || 25} cm.`);
      playBeepSound(600, 0.4);
    }

    // Inject persisted database bins & logs if returned by server
    if (payload.bins) {
      state.bins = payload.bins;
    }
    if (payload.detectionLog) {
      state.detectionLog = payload.detectionLog;
    }
    if (payload.alertHistory && payload.alertHistory.length > 0) {
      state.alertHistory = payload.alertHistory;
    }

    if (window.CameraVisionEngine) {
      if (payload.imageB64 && window.CameraVisionEngine.renderLiveStreamFrame) {
        window.CameraVisionEngine.renderLiveStreamFrame(payload.imageB64);
      }
    }
    
    if (payload.posX !== undefined) state.posX = parseFloat(payload.posX);
    if (payload.posY !== undefined) state.posY = parseFloat(payload.posY);
    
    if (payload.currentCP) state.currentCP = payload.currentCP;
    if (payload.nextCP) state.nextCP = payload.nextCP;
    if (payload.distanceToNext !== undefined) state.distanceToNext = parseFloat(payload.distanceToNext);
    if (payload.etaSeconds !== undefined) state.etaSeconds = parseInt(payload.etaSeconds);
    
    if (payload.batteryVoltage !== undefined) state.batteryVoltage = parseFloat(payload.batteryVoltage);

    if (payload.batteryPct !== undefined) {
      const oldPct = state.batteryPct;
      state.batteryPct = Math.max(0, Math.min(100, parseInt(payload.batteryPct)));
      if (state.batteryPct <= 20 && oldPct > 20) {
        triggerAlert('warning', '⚠️ Peringatan Baterai Aki Lemah!', `Tegangan aki tersisa ${state.batteryVoltage.toFixed(1)}V (${state.batteryPct}%)`);
        playBeepSound(440, 0.4);
      }
    }

    // Update position on arena map
    if (window.ArenaMapEngine && window.ArenaMapEngine.setRobotPosition) {
      window.ArenaMapEngine.setRobotPosition(state.posX, state.posY);
    }

    // Process detected object from camera payload if provided
    if (payload.detectedObject) {
      const obj = payload.detectedObject;
      if (window.CameraVisionEngine && window.CameraVisionEngine.renderHardwareSnapshot) {
        window.CameraVisionEngine.renderHardwareSnapshot(obj);
      }
    }

    notify();
  }

  async function resetBin(binKey) {
    if (state.bins[binKey]) {
      state.bins[binKey].count = 0;
      evaluateBinStatus(binKey);
      notify();
    }
    try {
      await fetch('/api/reset-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: binKey })
      });
    } catch (e) {
      console.warn('Reset bin API error:', e);
    }
  }

  async function setBinMaxCapacity(binKey, newMax) {
    if (state.bins[binKey] && newMax > 0) {
      state.bins[binKey].max = parseInt(newMax);
      evaluateBinStatus(binKey);
      notify();
    }
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: binKey, maxCapacity: parseInt(newMax) })
      });
    } catch (e) {
      console.warn('Settings API error:', e);
    }
  }

  async function clearAllData() {
    Object.keys(state.bins).forEach(binKey => {
      if (state.bins[binKey]) {
        state.bins[binKey].count = 0;
        evaluateBinStatus(binKey);
      }
    });
    state.detectionLog = [];
    notify();

    try {
      await fetch('/api/clear-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.warn('Clear all API error:', e);
    }
  }

  // Audio alert generator
  function playBeepSound(frequency = 750, duration = 0.25) {
    if (!state.soundAlertsEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback restricted', e);
    }
  }

  // Trigger Alert Toast & Add to Alert Inbox System
  function triggerAlert(type, title, message) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    state.alertHistory.unshift({
      id: Date.now(),
      type: type || 'info',
      title: title,
      message: message,
      time: timeStr
    });

    if (state.alertHistory.length > 30) state.alertHistory.pop();
    state.unreadAlertsCount += 1;

    // Toast Popup Banner
    const container = document.getElementById('globalAlertContainer');
    if (container) {
      const toast = document.createElement('div');
      toast.className = `toast-alert ${type === 'warning' ? 'warning' : (type === 'danger' ? 'danger' : '')}`;
      toast.innerHTML = `
        <div class="toast-icon">${type === 'warning' ? '⚠️' : (type === 'danger' ? '🚨' : 'ℹ️')}</div>
        <div class="toast-content">
          <h4>${title}</h4>
          <p>${message}</p>
        </div>
      `;

      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    notify();
  }

  function markAlertsAsRead() {
    state.unreadAlertsCount = 0;
    notify();
  }

  function clearAlertHistory() {
    state.alertHistory = [];
    state.unreadAlertsCount = 0;
    notify();
  }

  return {
    getState: () => state,
    subscribe,
    notify,
    addTrashItem,
    updateFromHardware,
    resetBin,
    setBinMaxCapacity,
    clearAllData,
    evaluateBinStatus,
    triggerAlert,
    markAlertsAsRead,
    clearAlertHistory,
    playBeepSound
  };
})();
