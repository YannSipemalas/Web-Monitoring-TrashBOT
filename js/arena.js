/**
 * Real-Time 2D Arena & Path Planning Canvas Engine
 * Connected to Live Telemetry from Physical Robot Hardware.
 */

window.ArenaMapEngine = (function () {
  let canvas, ctx;
  let animFrameId = null;

  // Arena dimensions in meters
  const ARENA_WIDTH_M = 10.0;
  const ARENA_HEIGHT_M = 6.0;

  // Checkpoint Nodes matching arena blueprint
  const checkpoints = [
    { id: 'START', label: 'START', x: 9.5, y: 0.6, isStart: true, number: 'S' },
    { id: 'CP1', label: 'CP1', x: 8.8, y: 0.6, number: 1 },
    { id: 'CP2', label: 'CP2', x: 0.7, y: 0.6, number: 2 },
    { id: 'CP3', label: 'CP3', x: 0.7, y: 5.4, number: 3 },
    { id: 'CP4', label: 'CP4', x: 8.8, y: 5.4, number: 4 }
  ];

  // Fixed obstacles matching Gazebo blueprint
  const obstacles = [
    { label: 'MEJA 1', x: 1.5, y: 4.35, w: 1.6, h: 0.5 },
    { label: 'MEJA 2', x: 1.5, y: 3.35, w: 1.6, h: 0.5 },
    { label: 'MEJA 3', x: 1.5, y: 2.15, w: 1.6, h: 0.5 },
    { label: 'MEJA 4', x: 1.5, y: 1.15, w: 1.6, h: 0.5 },
    { label: 'LAPANGAN BOLA', x: 3.6, y: 1.9, w: 3.2, h: 2.2, isField: true },
    { label: 'LAPANGAN BOLA', x: 7.0, y: 1.9, w: 1.6, h: 2.2, isField: true }
  ];

  // Real Robot Live Position State (Default at START: 9.5, 0.6)
  let robotPos = { x: 9.5, y: 0.6, angle: Math.PI };
  let pathTrail = [];

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    if ('ResizeObserver' in window && canvas.parentElement) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(canvas.parentElement);
    }

    // Hide X,Y overlay to prevent covering START & CP1
    const overlay = document.getElementById('arenaCoordsOverlay');
    if (overlay) overlay.style.display = 'none';

    // Initial position at START
    robotPos.x = checkpoints[0].x;
    robotPos.y = checkpoints[0].y;

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });

    startRenderLoop();
  }

  function handleTouchStart(e) {
    if (e.touches && e.touches.length > 0) {
      handleCanvasClick(e.touches[0]);
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * window.devicePixelRatio);
    canvas.height = Math.round(rect.height * window.devicePixelRatio);
    render();
  }

  // Convert meters to canvas pixels (Y flipped for top-left canvas origin)
  function mToPx(mx, my) {
    const scaleX = canvas.width / ARENA_WIDTH_M;
    const scaleY = canvas.height / ARENA_HEIGHT_M;
    const px = mx * scaleX;
    const py = canvas.height - (my * scaleY);
    return { x: px, y: py };
  }

  function pxToM(px, py) {
    const scaleX = canvas.width / ARENA_WIDTH_M;
    const scaleY = canvas.height / ARENA_HEIGHT_M;
    const mx = Math.max(0, Math.min(ARENA_WIDTH_M, px / scaleX));
    const my = Math.max(0, Math.min(ARENA_HEIGHT_M, (canvas.height - py) / scaleY));
    return { x: mx, y: my, mx: mx, my: my };
  }

  function startRenderLoop() {
    function step() {
      render();
      animFrameId = requestAnimationFrame(step);
    }
    step();
  }

  // Live Robot Position Update (From Hardware API Telemetry)
  function setRobotPosition(x, y, angle) {
    robotPos.x = parseFloat(x);
    robotPos.y = parseFloat(y);
    if (angle !== undefined) robotPos.angle = parseFloat(angle);

    // Record trail point
    pathTrail.push({ x: robotPos.x, y: robotPos.y, alpha: 1.0 });
    if (pathTrail.length > 40) pathTrail.shift();

    render();
  }

  function render() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // Grid lines
    drawGrid(isDark);

    // Obstacles (MEJA A, MEJA B, SEKAT TENGAH)
    drawObstacles(isDark);

    // Path trajectory dashed lines with direction arrows
    drawPathTrajectory(isDark);

    // Robot movement trail
    drawRobotTrail();

    // Checkpoint nodes
    drawCheckpoints(isDark);

    // Robot Illustration Avatar
    drawRobotSprite(isDark);
  }

  function drawGrid(isDark) {
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1 * window.devicePixelRatio;

    for (let x = 0; x <= ARENA_WIDTH_M; x += 1.0) {
      const p1 = mToPx(x, 0);
      const p2 = mToPx(x, ARENA_HEIGHT_M);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (let y = 0; y <= ARENA_HEIGHT_M; y += 1.0) {
      const p1 = mToPx(0, y);
      const p2 = mToPx(ARENA_WIDTH_M, y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  function drawObstacles(isDark) {
    obstacles.forEach(obs => {
      const p = mToPx(obs.x, obs.y + obs.h);
      const scaleX = canvas.width / ARENA_WIDTH_M;
      const scaleY = canvas.height / ARENA_HEIGHT_M;
      const wPx = obs.w * scaleX;
      const hPx = obs.h * scaleY;

      ctx.save();
      if (obs.isField) {
        ctx.fillStyle = isDark ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.18)';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2 * window.devicePixelRatio;
      } else {
        ctx.fillStyle = isDark ? 'rgba(180, 83, 9, 0.35)' : 'rgba(217, 119, 6, 0.22)';
        ctx.strokeStyle = isDark ? '#f59e0b' : '#d97706';
        ctx.lineWidth = 2 * window.devicePixelRatio;
      }

      const radius = 6 * window.devicePixelRatio;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, wPx, hPx, radius);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = obs.isField ? '#10b981' : (isDark ? '#fbbf24' : '#b45309');
      ctx.font = `bold ${10 * window.devicePixelRatio}px 'Plus Jakarta Sans', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obs.label, p.x + wPx / 2, p.y + hPx / 2);

      ctx.restore();
    });
  }

  function drawPathTrajectory(isDark) {
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(96, 165, 250, 0.6)' : 'rgba(37, 99, 235, 0.55)';
    ctx.lineWidth = 2.5 * window.devicePixelRatio;
    ctx.setLineDash([8 * window.devicePixelRatio, 6 * window.devicePixelRatio]);

    // Path 1: START (0) -> CP1 (1)
    drawDashedSegment(checkpoints[0], checkpoints[1], 'left', isDark);

    // Path 2: CP1 (1) -> CP2 (2)
    drawDashedSegment(checkpoints[1], checkpoints[2], 'left', isDark);

    // Path 3: CP2 (2) -> CP3 (3)
    drawDashedSegment(checkpoints[2], checkpoints[3], 'up', isDark);

    // Path 4: CP3 (3) -> CP4 (4)
    drawDashedSegment(checkpoints[3], checkpoints[4], 'right', isDark);

    // Path 5: CP4 (4) -> CP1 (1) [Looping back]
    drawDashedSegment(checkpoints[4], checkpoints[1], 'down', isDark);

    ctx.restore();
  }

  function drawDashedSegment(p1, p2, dir, isDark) {
    const pt1 = mToPx(p1.x, p1.y);
    const pt2 = mToPx(p2.x, p2.y);

    ctx.beginPath();
    ctx.moveTo(pt1.x, pt1.y);
    ctx.lineTo(pt2.x, pt2.y);
    ctx.stroke();

    const midX = (pt1.x + pt2.x) / 2;
    const midY = (pt1.y + pt2.y) / 2;
    drawDirectionArrow(midX, midY, dir, isDark);
  }

  function drawArcSegment(cp1, cp2, cp3, isDark) {
    const p1 = mToPx(cp1.x, cp1.y);
    const p2 = mToPx(cp2.x, cp2.y);
    const p3 = mToPx(cp3.x, cp3.y);

    const control = { x: p2.x, y: p2.y - 30 * window.devicePixelRatio };

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(control.x, control.y, p3.x, p3.y);
    ctx.stroke();

    const midLeftX = (p1.x + p2.x) / 2;
    const midLeftY = (p1.y + p2.y) / 2 - 10 * window.devicePixelRatio;
    drawDirectionArrow(midLeftX, midLeftY, 'right', isDark);

    const midRightX = (p2.x + p3.x) / 2;
    const midRightY = (p2.y + p3.y) / 2 - 10 * window.devicePixelRatio;
    drawDirectionArrow(midRightX, midRightY, 'left', isDark);
  }

  function drawDirectionArrow(x, y, dir, isDark) {
    ctx.save();
    ctx.translate(x, y);

    let angle = 0;
    if (dir === 'up') angle = -Math.PI / 2;
    else if (dir === 'down') angle = Math.PI / 2;
    else if (dir === 'left') angle = Math.PI;
    else if (dir === 'right') angle = 0;

    ctx.rotate(angle);
    ctx.fillStyle = isDark ? '#60a5fa' : '#2563eb';
    ctx.beginPath();
    ctx.moveTo(6 * window.devicePixelRatio, 0);
    ctx.lineTo(-6 * window.devicePixelRatio, -5 * window.devicePixelRatio);
    ctx.lineTo(-3 * window.devicePixelRatio, 0);
    ctx.lineTo(-6 * window.devicePixelRatio, 5 * window.devicePixelRatio);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawRobotTrail() {
    pathTrail.forEach(pt => {
      const p = mToPx(pt.x, pt.y);
      ctx.fillStyle = `rgba(37, 99, 235, ${pt.alpha * 0.25})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
      pt.alpha -= 0.015;
    });
    pathTrail = pathTrail.filter(pt => pt.alpha > 0);
  }

  function drawCheckpoints(isDark) {
    checkpoints.forEach((cp) => {
      const p = mToPx(cp.x, cp.y);
      const isCurrentTarget = RobotTelemetry.getState().nextCP === cp.label;

      ctx.save();

      if (isCurrentTarget) {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 3 * window.devicePixelRatio;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowColor = '#2563eb';
        ctx.shadowBlur = 12 * window.devicePixelRatio;
      }

      ctx.fillStyle = isCurrentTarget ? '#2563eb' : (isDark ? '#1e293b' : '#ffffff');
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3 * window.devicePixelRatio;

      const radius = 13 * window.devicePixelRatio;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isCurrentTarget ? '#ffffff' : '#2563eb';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = isDark ? '#f8fafc' : '#1e293b';
      ctx.font = `bold ${11 * window.devicePixelRatio}px 'Plus Jakarta Sans', sans-serif`;
      ctx.textAlign = 'center';

      ctx.fillText(cp.label, p.x, p.y - radius - (6 * window.devicePixelRatio));

      ctx.restore();
    });
  }

  function drawRobotSprite(isDark) {
    const p = mToPx(robotPos.x, robotPos.y);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-robotPos.angle);

    const scaleX = canvas.width / ARENA_WIDTH_M;
    const scaleY = canvas.height / ARENA_HEIGHT_M;

    // Standing Upright Robot Octagonal Base Footprint: 0.60m x 0.60m
    const w = 0.60 * scaleX;
    const h = 0.60 * scaleY;

    ctx.shadowColor = 'rgba(37, 99, 235, 0.4)';
    ctx.shadowBlur = 10 * window.devicePixelRatio;

    // 1. Draw 4 Small Wheels Mounted Underneath Corners (Image 2)
    const wheelR = w * 0.12;
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1 * window.devicePixelRatio;

    [
      { x: w/2 - wheelR, y: -h/2 + wheelR },
      { x: w/2 - wheelR, y: h/2 - wheelR },
      { x: -w/2 + wheelR, y: -h/2 + wheelR },
      { x: -w/2 + wheelR, y: h/2 - wheelR }
    ].forEach(wheel => {
      ctx.beginPath();
      ctx.arc(wheel.x, wheel.y, wheelR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // 2. Draw Octagonal Chassis Frame Base (Image 3)
    ctx.fillStyle = isDark ? '#1e293b' : '#f8fafc';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2.5 * window.devicePixelRatio;

    const cut = w * 0.25;
    ctx.beginPath();
    ctx.moveTo(-w/2 + cut, -h/2);
    ctx.lineTo(w/2 - cut, -h/2);
    ctx.lineTo(w/2, -h/2 + cut);
    ctx.lineTo(w/2, h/2 - cut);
    ctx.lineTo(w/2 - cut, h/2);
    ctx.lineTo(-w/2 + cut, h/2);
    ctx.lineTo(-w/2, h/2 - cut);
    ctx.lineTo(-w/2, -h/2 + cut);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 3. Front Direction Pointer
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(w/2 + 3, 0);
    ctx.lineTo(w/2 - 5, -4 * window.devicePixelRatio);
    ctx.lineTo(w/2 - 5, 4 * window.devicePixelRatio);
    ctx.closePath();
    ctx.fill();

    // 4. Center Label / Icon
    ctx.fillStyle = '#2563eb';
    ctx.font = `bold ${9 * window.devicePixelRatio}px 'Plus Jakarta Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TRASH-BOT', 0, 0);

    ctx.restore();
  }

  function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const m = pxToM(px, py);

    const overlay = document.getElementById('arenaCoordsOverlay');
    if (overlay && m && m.x !== undefined) {
      overlay.textContent = `X: ${m.x.toFixed(1)} m  Y: ${m.y.toFixed(1)} m`;
    }
  }

  function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const m = pxToM(px, py);

    if (!m) return;

    checkpoints.forEach((cp) => {
      const dist = Math.hypot(cp.x - m.x, cp.y - m.y);
      if (dist < 0.8) {
        RobotTelemetry.triggerAlert('info', 'Checkpoint Selected', `Robot directed to ${cp.label}`);
      }
    });
  }

  return {
    init,
    setRobotPosition
  };
})();
