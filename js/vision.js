/**
 * Real-Time Camera Vision Engine & Canvas Overlay Renderer v2
 * Handles MJPEG Stream connection, letterbox-aware HUD ROI, smoothly interpolated bounding boxes, and FPS HUD.
 */

window.CameraVisionEngine = (function () {
  let canvas, ctx;
  let mjpegImg = null;
  
  let cameraConnected = false;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  
  let flashAlpha = 0.0;
  let shutterSoundCtx = null;
  let currentSnapshot = null;

  // Active Detection Boxes & Smooth Interpolation State
  let targetBoxes = [];
  let currentBoxes = [];
  let lastBoxUpdateTime = 0;

  // ROI Polygon Definitions (Relative 0..1 coordinates)
  let roiActive = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.80], [0.25, 0.80]];
  let roiGuard = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];

  // Real-Time System Performance Stats (FPS & Latency)
  let statsData = {
    camera_fps: 0,
    yolo_fps: 0,
    yolo_ms: 0,
    stream_fps: 0
  };
  let showFpsHud = false; // Toggleable via UI button

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    mjpegImg = document.getElementById('mjpegFeed');
    if (mjpegImg) {
      bindStreamEvents();
      setupVideoStreamUrl();
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    if ('ResizeObserver' in window && canvas.parentElement) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(canvas.parentElement);
    }

    // Page Visibility API: Pause stream on hidden tab to save resources
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (mjpegImg) mjpegImg.src = '';
      } else {
        setupVideoStreamUrl();
      }
    });

    // Start 60 FPS Render & Interpolation Loop
    requestAnimationFrame(renderLoop);
  }

  function setupVideoStreamUrl() {
    if (!mjpegImg) return;
    const host = window.location.hostname || 'localhost';
    const streamUrl = `${window.location.protocol}//${host}:5000/video_feed?t=${Date.now()}`;
    mjpegImg.src = streamUrl;
  }

  function bindStreamEvents() {
    if (!mjpegImg) return;

    mjpegImg.onload = () => {
      if (!cameraConnected) {
        cameraConnected = true;
        reconnectDelay = 1000;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        updateCameraStatusBadge(true);
      }
    };

    mjpegImg.onerror = () => {
      if (cameraConnected) {
        cameraConnected = false;
        updateCameraStatusBadge(false);
      }
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      console.warn(`🔄 Reconnecting MJPEG stream (Delay: ${reconnectDelay}ms)...`);
      setupVideoStreamUrl();
      reconnectDelay = Math.min(reconnectDelay * 2, 5000);
    }, reconnectDelay);
  }

  function setCameraConnection(isOnline) {
    // Left empty intentionally to prevent external telemetry from overriding stream connectivity
  }

  function updateCameraStatusBadge(isOnline) {
    const camBadge = document.getElementById('cameraStatusBadge');
    if (camBadge) {
      camBadge.className = `status-badge ${isOnline ? 'online' : 'offline'}`;
      camBadge.innerHTML = isOnline ? '● MODUL KAMERA READY' : '● KAMERA NON-AKTIF';
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * window.devicePixelRatio);
    canvas.height = Math.round(rect.height * window.devicePixelRatio);
  }

  /**
   * Update Boxes & ROI from 100ms API Polling
   */
  function updateDetections(payload) {
    if (!payload) return;

    if (payload.roi_active && payload.roi_active.length > 0) roiActive = payload.roi_active;
    if (payload.roi_guard && payload.roi_guard.length > 0) roiGuard = payload.roi_guard;

    if (payload.boxes) {
      targetBoxes = payload.boxes;
      lastBoxUpdateTime = Date.now();
    }

    if (payload.event) {
      renderHardwareSnapshot(payload.event);
    }
  }

  function updateStats(stats) {
    if (stats) {
      statsData = stats;
    }
  }

  function toggleFpsHud(enable) {
    if (enable !== undefined) {
      showFpsHud = !!enable;
    } else {
      showFpsHud = !showFpsHud;
    }
    return showFpsHud;
  }

  function renderHardwareSnapshot(detectionPayload) {
    if (!detectionPayload) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    currentSnapshot = {
      timestamp: timeStr,
      itemName: detectionPayload.itemName || 'Objek Sampah',
      categoryName: detectionPayload.category || 'Unknown',
      confidence: parseFloat((detectionPayload.confidence || 95.0).toFixed(1))
    };

    flashAlpha = 0.85;
    playShutterSound();

    if (window.RobotTelemetry && window.RobotTelemetry.triggerAlert) {
      RobotTelemetry.triggerAlert(
        'info',
        `BARANG MASUK TERDETEKSI!`,
        `${currentSnapshot.itemName} (${currentSnapshot.categoryName}) - Akurasi ${currentSnapshot.confidence}%`
      );
    }
  }

  function playShutterSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!shutterSoundCtx) shutterSoundCtx = new AudioCtx();
      
      const osc = shutterSoundCtx.createOscillator();
      const gain = shutterSoundCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, shutterSoundCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, shutterSoundCtx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, shutterSoundCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, shutterSoundCtx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(shutterSoundCtx.destination);

      osc.start();
      osc.stop(shutterSoundCtx.currentTime + 0.08);
    } catch (e) {}
  }

  /**
   * Main 60 FPS Canvas Render Loop
   */
  function renderLoop() {
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!cameraConnected) {
        drawOfflineCameraViewport();
      } else {
        const layout = getLetterboxLayout();

        // 1. Draw ROI Lines (Active & Guard) on Canvas
        drawRoiPolygons(layout);

        // 2. Smooth Box Interpolation & Drawing
        updateAndDrawBoxes(layout);

        // 3. Corner Brackets HUD
        drawHUDOverlay();

        // 4. Toggleable Performance FPS HUD
        if (showFpsHud) {
          drawFpsHudOverlay();
        }
      }

      // Flash effect animation
      if (flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        flashAlpha *= 0.82;
      }
    }

    requestAnimationFrame(renderLoop);
  }

  /**
   * Computes exact image letterbox coordinates for object-fit: contain
   */
  function getLetterboxLayout() {
    const dpr = window.devicePixelRatio || 1;
    const canvasW = canvas.width;
    const canvasH = canvas.height;

    const naturalW = (mjpegImg && mjpegImg.naturalWidth) ? mjpegImg.naturalWidth : 640;
    const naturalH = (mjpegImg && mjpegImg.naturalHeight) ? mjpegImg.naturalHeight : 480;

    const scale = Math.min(canvasW / naturalW, canvasH / naturalH);
    const renderW = naturalW * scale;
    const renderH = naturalH * scale;

    const offsetX = (canvasW - renderW) / 2;
    const offsetY = (canvasH - renderH) / 2;

    return {
      dpr,
      canvasW,
      canvasH,
      offsetX,
      offsetY,
      renderW,
      renderH,
      toCanvasX: (xPct) => offsetX + xPct * renderW,
      toCanvasY: (yPct) => offsetY + yPct * renderH
    };
  }

  function drawRoiPolygons(layout) {
    if (!layout) return;

    // Guard ROI (Yellow)
    if (roiGuard && roiGuard.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.85)';
      ctx.lineWidth = 2 * layout.dpr;
      ctx.setLineDash([6 * layout.dpr, 4 * layout.dpr]);
      ctx.beginPath();
      roiGuard.forEach(([ptX, ptY], idx) => {
        const cx = layout.toCanvasX(ptX);
        const cy = layout.toCanvasY(ptY);
        if (idx === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.stroke();

      // Label
      const p0X = layout.toCanvasX(roiGuard[0][0]);
      const p0Y = layout.toCanvasY(roiGuard[0][1]);
      ctx.fillStyle = '#eab308';
      ctx.font = `bold ${10 * layout.dpr}px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillText("GUARD ROI", p0X + 8 * layout.dpr, p0Y + 16 * layout.dpr);
      ctx.restore();
    }

    // Active ROI (Cyan / Green)
    if (roiActive && roiActive.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)';
      ctx.lineWidth = 2.5 * layout.dpr;
      ctx.beginPath();
      roiActive.forEach(([ptX, ptY], idx) => {
        const cx = layout.toCanvasX(ptX);
        const cy = layout.toCanvasY(ptY);
        if (idx === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.fill();

      // Label
      const p0X = layout.toCanvasX(roiActive[0][0]);
      const p0Y = layout.toCanvasY(roiActive[0][1]);
      ctx.fillStyle = '#06b6d4';
      ctx.font = `bold ${10 * layout.dpr}px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillText("ACTIVE ROI : TERDETEKSI", p0X + 8 * layout.dpr, p0Y + 16 * layout.dpr);
      ctx.restore();
    }
  }

  function updateAndDrawBoxes(layout) {
    const now = Date.now();
    
    // Clear boxes if API update stopped for > 600ms
    if (now - lastBoxUpdateTime > 600) {
      targetBoxes = [];
    }

    // Adjust size of currentBoxes array
    while (currentBoxes.length < targetBoxes.length) {
      currentBoxes.push({ ...targetBoxes[currentBoxes.length] });
    }
    if (currentBoxes.length > targetBoxes.length) {
      currentBoxes.length = targetBoxes.length;
    }

    // Smooth Linear Interpolation (Lerp 25%)
    for (let i = 0; i < targetBoxes.length; i++) {
      const tb = targetBoxes[i];
      const cb = currentBoxes[i];

      cb.xPct += (tb.xPct - cb.xPct) * 0.25;
      cb.yPct += (tb.yPct - cb.yPct) * 0.25;
      cb.wPct += (tb.wPct - cb.wPct) * 0.25;
      cb.hPct += (tb.hPct - cb.hPct) * 0.25;

      cb.name = tb.name;
      cb.category = tb.category;
      cb.confidence = tb.confidence;
      cb.trackId = tb.trackId;
      cb.inActive = tb.inActive;
    }

    // Draw Smooth Bounding Boxes
    currentBoxes.forEach((box) => {
      const x = layout.toCanvasX(box.xPct);
      const y = layout.toCanvasY(box.yPct);
      const w = box.wPct * layout.renderW;
      const h = box.hPct * layout.renderH;

      ctx.save();

      const borderColor = box.inActive ? '#10b981' : '#3b82f6'; // Green if in active ROI, blue otherwise
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2.5 * layout.dpr;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();

      ctx.fillStyle = box.inActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.12)';
      ctx.fillRect(x, y, w, h);

      // Label Tag
      const trackTag = box.trackId !== null && box.trackId !== undefined ? `#${box.trackId} ` : '';
      const labelText = `${trackTag}${box.name} (${box.confidence}%)`;

      ctx.font = `bold ${10.5 * layout.dpr}px 'Plus Jakarta Sans', sans-serif`;
      const textMetrics = ctx.measureText(labelText);
      const tagPadding = 5 * layout.dpr;
      const tagW = textMetrics.width + (tagPadding * 2);
      const tagH = 20 * layout.dpr;

      const tagY = Math.max(layout.offsetY, y - tagH);

      ctx.fillStyle = borderColor;
      ctx.fillRect(x, tagY, tagW, tagH);

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, x + tagPadding, tagY + tagH / 2);

      ctx.restore();
    });
  }

  function drawFpsHudOverlay() {
    const scale = window.devicePixelRatio || 1;
    const hudX = 14 * scale;
    const hudY = 32 * scale;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1 * scale;

    const text = `CAM: ${statsData.camera_fps || 0} FPS  |  YOLO: ${statsData.yolo_fps || 0} FPS (${statsData.yolo_ms || 0}ms)  |  STREAM: ${statsData.stream_fps || 0} FPS`;
    ctx.font = `600 ${10 * scale}px 'JetBrains Mono', monospace`;
    const metrics = ctx.measureText(text);

    const padX = 8 * scale;
    const padY = 5 * scale;
    const boxW = metrics.width + padX * 2;
    const boxH = 18 * scale + padY * 2;

    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(hudX, hudY, boxW, boxH, 4 * scale) : ctx.rect(hudX, hudY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, hudX + padX, hudY + boxH / 2);

    ctx.restore();
  }

  function drawOfflineCameraViewport() {
    const scale = window.devicePixelRatio;

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#1a0505');
    grad.addColorStop(0.5, '#2a0c0c');
    grad.addColorStop(1, '#0f0505');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(239, 68, 68, 0.08)';
    ctx.lineWidth = 2 * scale;
    const spacing = 30 * scale;

    for (let x = -canvas.height; x < canvas.width + canvas.height; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + canvas.height, canvas.height);
      ctx.stroke();
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.fillStyle = '#ef4444';
    ctx.font = `bold ${32 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷🚫', cx, cy - 22 * scale);

    ctx.fillStyle = '#f87171';
    ctx.font = `bold ${13 * scale}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillText('MODUL KAMERA NON-AKTIF / MENGHUBUNGKAN...', cx, cy + 12 * scale);

    ctx.fillStyle = '#fca5a5';
    ctx.font = `500 ${10.5 * scale}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillText('Memeriksa koneksi stream MJPEG backend', cx, cy + 30 * scale);
  }

  function drawHUDOverlay() {
    const scale = window.devicePixelRatio;
    ctx.strokeStyle = cameraConnected ? 'rgba(255, 255, 255, 0.35)' : 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 2 * scale;

    const margin = 14 * scale;
    const len = 12 * scale;

    // Top-Left bracket
    ctx.beginPath();
    ctx.moveTo(margin, margin + len);
    ctx.lineTo(margin, margin);
    ctx.lineTo(margin + len, margin);
    ctx.stroke();

    // Top-Right bracket
    ctx.beginPath();
    ctx.moveTo(canvas.width - margin - len, margin);
    ctx.lineTo(canvas.width - margin, margin);
    ctx.lineTo(canvas.width - margin, margin + len);
    ctx.stroke();

    // Bottom-Left bracket
    ctx.beginPath();
    ctx.moveTo(margin, canvas.height - margin - len);
    ctx.lineTo(margin, canvas.height - margin);
    ctx.lineTo(margin + len, canvas.height - margin);
    ctx.stroke();

    // Bottom-Right bracket
    ctx.beginPath();
    ctx.moveTo(canvas.width - margin - len, canvas.height - margin);
    ctx.lineTo(canvas.width - margin, canvas.height - margin);
    ctx.lineTo(canvas.width - margin, canvas.height - margin - len);
    ctx.stroke();
  }

  return {
    init,
    setCameraConnection,
    updateDetections,
    updateStats,
    toggleFpsHud,
    renderHardwareSnapshot
  };
})();
