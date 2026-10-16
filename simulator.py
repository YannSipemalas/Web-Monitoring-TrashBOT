#!/usr/bin/env python3
"""
=============================================================================
ROBOT TELEMETRY, ODOMETRY & PATH PLANNING SIMULATOR
=============================================================================
Simulates real-time hardware telemetry data for testing the Web Monitoring Dashboard:
- Odometry Position (X, Y) smoothly navigating between checkpoints (START -> CP1 -> CP2 -> CP3 -> CP4 -> CP5)
- Battery Voltage & Percentage monitoring
- Obstacle Sensor & Emergency Stop handling (STOPPED_OBSTACLE)
"""

import time
import math
import requests
import sys

API_URL = "http://localhost:8080/api/telemetry"

CHECKPOINTS = [
    {"id": "START", "x": 1.2, "y": 1.0},
    {"id": "CP1", "x": 1.2, "y": 5.0},
    {"id": "CP2", "x": 5.0, "y": 5.4},
    {"id": "CP3", "x": 8.8, "y": 5.0},
    {"id": "CP4", "x": 8.8, "y": 1.0},
    {"id": "CP5", "x": 5.0, "y": 1.0},
]

def distance(x1, y1, x2, y2):
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

def run_simulation():
    print("==================================================================")
    print("   TRASH SORTING BOT - ODOMETRY & PATH PLANNING SIMULATOR       ")
    print("==================================================================")
    print(f"[INIT] Sending simulated telemetry to: {API_URL}")
    print("[INFO] Simulating Odometry X/Y, Checkpoints, Battery, & Obstacles.")
    print("[INFO] Press Ctrl+C to stop simulation.\n")

    cp_idx = 0
    curr_x = CHECKPOINTS[0]["x"]
    curr_y = CHECKPOINTS[0]["y"]

    speed = 0.3  # meters per second
    battery_pct = 95
    battery_voltage = 12.4
    step_count = 0

    while True:
        target_cp = CHECKPOINTS[(cp_idx + 1) % len(CHECKPOINTS)]
        dist = distance(curr_x, curr_y, target_cp["x"], target_cp["y"])

        if dist < 0.2:
            cp_idx = (cp_idx + 1) % len(CHECKPOINTS)
            target_cp = CHECKPOINTS[(cp_idx + 1) % len(CHECKPOINTS)]
            dist = distance(curr_x, curr_y, target_cp["x"], target_cp["y"])

        # Move towards target
        dx = (target_cp["x"] - curr_x) / (dist if dist > 0 else 1) * speed * 0.3
        dy = (target_cp["y"] - curr_y) / (dist if dist > 0 else 1) * speed * 0.3
        curr_x += dx
        curr_y += dy

        eta_sec = int(dist / speed) if speed > 0 else 0

        # Simulate obstacle event every 60 steps for 3 seconds
        step_count += 1
        is_obstacle = (120 <= (step_count % 200) <= 135)
        op_state = "STOPPED_OBSTACLE" if is_obstacle else "NAVIGATING"

        # Battery slow discharge simulation
        if step_count % 30 == 0 and battery_pct > 15:
            battery_pct -= 1
            battery_voltage = round(10.5 + (battery_pct / 100.0) * 2.1, 1)

        payload = {
            "connected": True,
            "cameraConnected": True,
            "operationState": op_state,
            "posX": round(curr_x, 2),
            "posY": round(curr_y, 2),
            "currentCP": CHECKPOINTS[cp_idx]["id"],
            "nextCP": target_cp["id"],
            "distanceToNext": round(dist, 1),
            "etaSeconds": eta_sec,
            "missionProgressPct": int((cp_idx / len(CHECKPOINTS)) * 100),
            "batteryPct": battery_pct,
            "batteryVoltage": battery_voltage,
            "obstacleDetected": is_obstacle,
            "obstacleDistanceCm": 25 if is_obstacle else 180
        }

        try:
            res = requests.post(API_URL, json=payload, timeout=0.5)
            if res.status_code == 200:
                obs_flag = " ⚠️ OBSTACLE!" if is_obstacle else ""
                print(f"[SIMULATOR] Pos: ({payload['posX']}m, {payload['posY']}m) -> {payload['nextCP']} | Batt: {battery_pct}% ({battery_voltage}V) | State: {op_state}{obs_flag}")
        except Exception as e:
            print(f"⚠️ Telemetry server offline or busy: {e}")

        time.sleep(0.3)

if __name__ == "__main__":
    try:
        run_simulation()
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Stopped by user.")
        sys.exit(0)
