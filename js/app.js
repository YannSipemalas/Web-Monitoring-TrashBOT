/**
 * Application Main Controller & UI Binding v2
 * Syncs DOM elements with Telemetry State, manages theme options and user interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Engines
  ArenaMapEngine.init('arenaCanvas');
  CameraVisionEngine.init('cameraCanvas');

  // Subscribe to Telemetry State changes
  RobotTelemetry.subscribe(renderUI);

  // Initial render
  renderUI(RobotTelemetry.getState());

  // Bind Buttons & DOM Listeners
  bindEvents();

  // Start Clock
  setInterval(updateClock, 1000);
  updateClock();

  // Start Hardware Telemetry Polling (300ms)
  pollHardwareTelemetryLoop();

  // Start Realtime YOLO Detection Polling (100ms)
  pollYoloDetectionLoop();

  // Start System Performance Stats Polling (1000ms)
  pollStatsLoop();
});

async function pollHardwareTelemetryLoop() {
  await pollHardwareTelemetry();
  setTimeout(pollHardwareTelemetryLoop, 200);
}

async function pollYoloDetectionLoop() {
  await pollYoloDetection();
  setTimeout(pollYoloDetectionLoop, 100);
}

async function pollStatsLoop() {
  await pollStats();
  setTimeout(pollStatsLoop, 1000);
}

// Automatic Polling to Python Flask YOLO API
async function pollYoloDetection() {
  try {
    const host = window.location.hostname || 'localhost';
    const apiUrl = `${window.location.protocol}//${host}:5000/api/latest_detection`;

    const response = await fetch(apiUrl);
    if (response.ok) {
      const data = await response.json();

      if (window.CameraVisionEngine && window.CameraVisionEngine.updateDetections) {
        window.CameraVisionEngine.updateDetections(data);
      }

      if (data && data.event) {
        const catName = (data.event.category || '').toLowerCase();
        let catKey = 'unknown';
        if (catName.includes('botol') || catName.includes('plastic')) catKey = 'plastic';
        else if (catName.includes('kertas') || catName.includes('paper')) catKey = 'paper';
        else if (catName.includes('kaleng') || catName.includes('can')) catKey = 'can';

        if (window.RobotTelemetry) {
          window.RobotTelemetry.addTrashItem(catKey, data.event.itemName, data.event.confidence);
        }
      }
    }
  } catch (err) {
    // Silently ignore fetch errors so stream remains uninterrupted
  }
}

// Polling System Stats (Camera FPS, YOLO FPS, Stream FPS)
async function pollStats() {
  try {
    const host = window.location.hostname || 'localhost';
    const apiUrl = `${window.location.protocol}//${host}:5000/api/stats`;

    const response = await fetch(apiUrl);
    if (response.ok) {
      const stats = await response.json();
      if (window.CameraVisionEngine && window.CameraVisionEngine.updateStats) {
        window.CameraVisionEngine.updateStats(stats);
      }
    }
  } catch (err) {}
}

// Automatic Telemetry Polling from Python Web Server Gateway
async function pollHardwareTelemetry() {
  try {
    const targetUrl = window.location.protocol.startsWith('http')
      ? '/api/telemetry'
      : 'http://localhost:8080/api/telemetry';

    const response = await fetch(targetUrl);
    if (response.ok) {
      const payload = await response.json();
      if (payload && Object.keys(payload).length > 0) {
        RobotTelemetry.updateFromHardware(payload);
      }
    }
  } catch (err) {
    console.warn('Telemetry polling error:', err);
  }
}

function renderUI(state) {
  // 1. Header Telemetry & Status Badges
  const connBadge = document.getElementById('connectionBadge');
  if (connBadge) {
    connBadge.className = `status-badge ${state.connected ? 'online' : 'offline'}`;
    connBadge.innerHTML = `<span class="pulse-dot"></span>${state.connected ? 'ONLINE' : 'OFFLINE'}`;
  }

  // Alert Inbox Bell Badge Count
  const badgeEl = document.getElementById('alertBadgeCount');
  if (badgeEl) {
    const unread = state.unreadAlertsCount || 0;
    badgeEl.textContent = unread;
    badgeEl.style.display = unread > 0 ? 'inline-block' : 'none';
  }

  // 2. Robot Movement Telemetry Cards
  setText('valPosX', `${state.posX.toFixed(2)} m`);
  setText('valPosY', `${state.posY.toFixed(2)} m`);
  setText('valBatteryPct', `${state.batteryPct}%`);
  setText('valBatteryVoltage', `${state.batteryVoltage.toFixed(1)} V`);
  setText('valCurrentCP', state.currentCP);
  setText('valNextCP', state.nextCP);
  setText('valDistance', `${state.distanceToNext.toFixed(1)} m`);
  setText('valETA', `${state.etaSeconds} dtk`);

  // Battery bar update
  const battFill = document.getElementById('batteryFillBar');
  if (battFill) {
    battFill.style.width = `${state.batteryPct}%`;
    battFill.className = `battery-fill ${state.batteryPct < 20 ? 'low' : ''}`;
  }

  // 3. Bin Capacities Rendering
  renderBins(state.bins);

  // 4. Detection History Log & Latest Banner
  renderDetectionLog(state.detectionLog);

  // 5. Alert Inbox Messages rendering
  renderAlertMessages(state.alertHistory);
}

function renderBins(bins) {
  const binKeys = ['plastic', 'paper', 'can', 'unknown'];

  binKeys.forEach(key => {
    const bin = bins[key];
    if (!bin) return;

    const pct = Math.min(100, Math.round((bin.count / bin.max) * 100));

    // Update numbers & percentages
    setText(`binCount_${key}`, bin.count);
    setText(`binMax_${key}`, `/ ${bin.max}`);
    setText(`binPct_${key}`, `${pct}%`);

    // Update Progress bar width
    const fillBar = document.getElementById(`binFill_${key}`);
    if (fillBar) fillBar.style.width = `${pct}%`;

    // Update status badge
    const badge = document.getElementById(`binStatus_${key}`);
    const binCard = document.getElementById(`binCard_${key}`);

    if (badge) {
      badge.textContent = bin.status;
      badge.className = 'bin-status-badge';
      if (bin.status === 'Normal') badge.classList.add('normal');
      else if (bin.status === 'Hampir Penuh') badge.classList.add('warning');
      else badge.classList.add('full');
    }

    if (binCard) {
      if (bin.status === 'Penuh') binCard.classList.add('is-full');
      else binCard.classList.remove('is-full');
    }
  });
}

function renderDetectionLog(logs) {
  const tableBody = document.getElementById('detectionLogTableBody');
  const latestBanner = document.getElementById('latestDetectedName');

  if (latestBanner) {
    if (logs.length > 0) {
      const top = logs[0];
      latestBanner.textContent = `${top.name}${top.size ? ' (' + top.size + ')' : ''}`;
    } else {
      latestBanner.textContent = '-';
    }
  }

  if (!tableBody) return;

  tableBody.innerHTML = logs.map(item => `
    <tr>
      <td style="color: var(--text-muted); font-size: 0.72rem;">${item.time}</td>
      <td style="font-weight: 600;">${item.name}</td>
      <td><span class="category-tag tag-${item.category}">${getCategoryDisplayName(item.category)}</span></td>
      <td style="font-size: 0.78rem; font-weight: 600; color: var(--text-primary);">${item.size || 'Sedang'}</td>
      <td style="text-align: right; font-weight: 700;">${item.confidence}%</td>
    </tr>
  `).join('');
}

function renderAlertMessages(alerts) {
  const container = document.getElementById('alertMessagesContainer');
  if (!container) return;

  if (!alerts || alerts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.8rem;">
        🕊️ Tidak ada pesan alert / notifikasi baru.
      </div>
    `;
    return;
  }

  container.innerHTML = alerts.map(alert => {
    const icon = alert.type === 'danger' ? '🚨' : (alert.type === 'warning' ? '⚠️' : 'ℹ️');
    const borderClass = alert.type === 'danger' ? 'danger' : (alert.type === 'warning' ? 'warning' : 'info');
    
    return `
      <div class="alert-msg-item ${borderClass}">
        <div style="font-size: 1.1rem; flex-shrink: 0;">${icon}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
            <h4 style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary); margin: 0;">${alert.title}</h4>
            <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 500;">${alert.time}</span>
          </div>
          <p style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 0.15rem;">${alert.message}</p>
        </div>
      </div>
    `;
  }).join('');
}

function getCategoryDisplayName(cat) {
  const map = { plastic: 'Botol Plastik', paper: 'Kertas', can: 'Kaleng', unknown: 'Unknown' };
  return map[cat] || cat;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
  setText('headerClock', timeStr);
}

function bindEvents() {
  // Theme Toggle Button
  const themeBtn = document.getElementById('btnToggleTheme');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      themeBtn.innerHTML = newTheme === 'dark' ? '☀️' : '🌙';
    });
  }

  // FPS HUD Toggle Button
  const btnToggleFpsHud = document.getElementById('btnToggleFpsHud');
  if (btnToggleFpsHud) {
    btnToggleFpsHud.addEventListener('click', () => {
      if (window.CameraVisionEngine && window.CameraVisionEngine.toggleFpsHud) {
        const isEnabled = window.CameraVisionEngine.toggleFpsHud();
        btnToggleFpsHud.classList.toggle('active', isEnabled);
        btnToggleFpsHud.textContent = isEnabled ? '⚡ HUD FPS: ON' : '⚡ HUD FPS: OFF';
      }
    });
  }

  // Simulation Arena Controls
  const btnStartSim = document.getElementById('btnStartSim');
  const btnPauseSim = document.getElementById('btnPauseSim');
  const btnResetSim = document.getElementById('btnResetSim');

  if (btnStartSim) btnStartSim.addEventListener('click', () => ArenaMapEngine.startSim());
  if (btnPauseSim) btnPauseSim.addEventListener('click', () => ArenaMapEngine.pauseSim());
  if (btnResetSim) btnResetSim.addEventListener('click', () => ArenaMapEngine.resetSim());

  // Alert Inbox Bell Button & Modal Controls
  const btnAlerts = document.getElementById('btnOpenAlerts');
  const alertsModal = document.getElementById('alertsModal');
  const btnCloseAlerts = document.getElementById('btnCloseAlerts');
  const btnCloseAlertsFooter = document.getElementById('btnCloseAlertsFooter');
  const btnClearAlerts = document.getElementById('btnClearAlerts');

  if (btnAlerts && alertsModal) {
    btnAlerts.addEventListener('click', () => {
      alertsModal.classList.add('active');
      RobotTelemetry.markAlertsAsRead();
    });
  }

  if (btnCloseAlerts && alertsModal) {
    btnCloseAlerts.addEventListener('click', () => alertsModal.classList.remove('active'));
  }
  if (btnCloseAlertsFooter && alertsModal) {
    btnCloseAlertsFooter.addEventListener('click', () => alertsModal.classList.remove('active'));
  }

  if (btnClearAlerts) {
    btnClearAlerts.addEventListener('click', () => RobotTelemetry.clearAlertHistory());
  }

  // Settings Modal Controls
  const btnSettings = document.getElementById('btnOpenSettings');
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseModal = document.getElementById('btnCloseSettings');
  const btnSaveSettings = document.getElementById('btnSaveSettings');

  if (btnSettings && settingsModal) {
    btnSettings.addEventListener('click', () => settingsModal.classList.add('active'));
  }

  if (btnCloseModal && settingsModal) {
    btnCloseModal.addEventListener('click', () => settingsModal.classList.remove('active'));
  }

  if (btnSaveSettings && settingsModal) {
    btnSaveSettings.addEventListener('click', () => {
      const maxPlastic = document.getElementById('inputMaxPlastic')?.value;
      const maxPaper = document.getElementById('inputMaxPaper')?.value;
      const maxCan = document.getElementById('inputMaxCan')?.value;
      const maxUnknown = document.getElementById('inputMaxUnknown')?.value;

      if (maxPlastic) RobotTelemetry.setBinMaxCapacity('plastic', maxPlastic);
      if (maxPaper) RobotTelemetry.setBinMaxCapacity('paper', maxPaper);
      if (maxCan) RobotTelemetry.setBinMaxCapacity('can', maxCan);
      if (maxUnknown) RobotTelemetry.setBinMaxCapacity('unknown', maxUnknown);

      settingsModal.classList.remove('active');
      RobotTelemetry.triggerAlert('info', 'Configuration Saved', 'Batas maksimal kapasitas tempat sampah diperbarui.');
    });
  }

  const btnClearAllData = document.getElementById('btnClearAllData');
  if (btnClearAllData) {
    btnClearAllData.addEventListener('click', () => {
      if (confirm('Apakah Anda yakin ingin mengosongkan semua data tempat sampah dan log deteksi?')) {
        RobotTelemetry.clearAllData();
        if (settingsModal) settingsModal.classList.remove('active');
        RobotTelemetry.triggerAlert('info', 'Data Dikosongkan', 'Seluruh data tempat sampah dan log deteksi telah di-reset ke 0.');
      }
    });
  }

  // Bin Manual Action Buttons (+1 Dump / Reset)
  const binKeys = ['plastic', 'paper', 'can', 'unknown'];
  binKeys.forEach(key => {
    const btnAdd = document.getElementById(`btnAdd_${key}`);
    const btnReset = document.getElementById(`btnReset_${key}`);

    if (btnAdd) btnAdd.addEventListener('click', () => RobotTelemetry.addTrashItem(key, `Manual ${key}`));
    if (btnReset) btnReset.addEventListener('click', () => RobotTelemetry.resetBin(key));
  });

  // WASD & QE Keyboard Teleop Controls on Web Dashboard Window
  let activeKeys = {};
  window.addEventListener('keydown', (e) => {
    if (['input', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) return;
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', ' '].includes(key)) {
      activeKeys[key] = true;
      sendWebCmdVel();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (['input', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) return;
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', ' '].includes(key)) {
      delete activeKeys[key];
      sendWebCmdVel();
    }
  });

  function sendWebCmdVel() {
    let lx = 0.0;
    let ly = 0.0;
    let az = 0.0;

    if (activeKeys['w']) lx += 0.5;
    if (activeKeys['s']) lx -= 0.5;
    if (activeKeys['q']) ly += 0.5;
    if (activeKeys['e']) ly -= 0.5;
    if (activeKeys['a']) az += 0.8;
    if (activeKeys['d']) az -= 0.8;

    const targetUrl = window.location.protocol.startsWith('http')
      ? '/api/cmd_vel'
      : 'http://localhost:8080/api/cmd_vel';

    fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linearX: lx, linearY: ly, angularZ: az })
    }).catch(() => {});
  }
}
