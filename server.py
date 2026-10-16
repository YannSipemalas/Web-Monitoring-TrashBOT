#!/usr/bin/env python3
"""
Trash Sorting Robot Monitoring - Multi-Threaded Gateway & Database Server
Serves static dashboard web files, REST API endpoints, and persists hardware telemetry to SQLite.
"""

import http.server
import socketserver
import json
import os
import sys
import time

import database

DEFAULT_PORT = 8080
latest_telemetry = {}
latest_cmd_vel = {"linearX": 0.0, "linearY": 0.0, "angularZ": 0.0, "timestamp": 0}
last_post_timestamp = 0
HEARTBEAT_TIMEOUT = 10.0  # 10 seconds timeout threshold for hardware heartbeat

def get_telemetry_payload():
    global latest_telemetry, last_post_timestamp

    db_bins = database.get_bin_capacities()
    db_logs = database.get_recent_detections(50)
    db_alerts = database.get_recent_alerts(30)

    # Hardware Watchdog: If no POST received for > 10 seconds, set OFFLINE
    if last_post_timestamp == 0 or (time.time() - last_post_timestamp > HEARTBEAT_TIMEOUT):
        base_payload = {
            "connected": False,
            "cameraConnected": False,
            "operationState": "OFFLINE",
            "posX": 9.50,
            "posY": 0.60,
            "currentCP": "START",
            "nextCP": "CP1",
            "distanceToNext": 0.0,
            "etaSeconds": 0,
            "batteryVoltage": 0.0,
            "batteryPct": 0
        }
    else:
        base_payload = dict(latest_telemetry)

    # Always inject persisted database state into response
    base_payload["bins"] = db_bins
    base_payload["detectionLog"] = db_logs
    base_payload["alertHistory"] = db_alerts

    return base_payload

class RobotDashboardHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS & Prevent Stale Browser Caching
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/telemetry':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            payload = get_telemetry_payload()
            self.wfile.write(json.dumps(payload).encode('utf-8'))
        elif self.path == '/api/cmd_vel':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(latest_cmd_vel).encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        if self.path == '/api/cmd_vel':
            try:
                global latest_cmd_vel
                data = json.loads(post_data.decode('utf-8'))
                latest_cmd_vel = {
                    "linearX": float(data.get("linearX", 0.0)),
                    "linearY": float(data.get("linearY", 0.0)),
                    "angularZ": float(data.get("angularZ", 0.0)),
                    "timestamp": time.time()
                }
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "cmd_vel": latest_cmd_vel}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        elif self.path == '/api/telemetry':
            try:
                global latest_telemetry, last_post_timestamp
                payload = json.loads(post_data.decode('utf-8'))
                latest_telemetry = payload
                last_post_timestamp = time.time()

                # If telemetry includes detected object confirmation, record in SQLite
                if "detectedObject" in payload and payload["detectedObject"]:
                    obj = payload["detectedObject"]
                    if obj.get("category") and obj.get("category") != "Unknown":
                        database.add_trash_item(
                            category=obj.get("category"),
                            item_name=obj.get("itemName", "Objek Sampah"),
                            size=obj.get("size", "Sedang"),
                            confidence=obj.get("confidence", 95.0)
                        )

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Live hardware telemetry received"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        elif self.path == '/api/add-detection':
            try:
                data = json.loads(post_data.decode('utf-8'))
                category = data.get("category", "unknown")
                item_name = data.get("itemName", "Objek Sampah")
                size = data.get("size", "Sedang")
                confidence = float(data.get("confidence", 95.0))

                database.add_trash_item(
                    category=category,
                    item_name=item_name,
                    size=size,
                    confidence=confidence
                )
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Detection recorded"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        elif self.path == '/api/reset-bin':
            try:
                data = json.loads(post_data.decode('utf-8'))
                category = data.get("category")
                if category:
                    database.reset_bin(category)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": f"Bin {category} reset"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        elif self.path == '/api/settings':
            try:
                data = json.loads(post_data.decode('utf-8'))
                category = data.get("category")
                max_cap = data.get("maxCapacity")
                if category and max_cap:
                    database.set_bin_max(category, max_cap)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Settings updated"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        elif self.path == '/api/clear-all':
            try:
                database.clear_all_data()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "All bin capacities and logs cleared"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        else:
            self.send_response(404)
            self.end_headers()

class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

def start_server():
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)

    database.init_db()

    port = DEFAULT_PORT
    httpd = None

    for p in range(DEFAULT_PORT, DEFAULT_PORT + 10):
        try:
            httpd = ReusableTCPServer(("", p), RobotDashboardHandler)
            port = p
            break
        except OSError as e:
            if e.errno == 98:
                continue
            else:
                raise e

    if not httpd:
        print(f"❌ Error: Could not bind server to ports {DEFAULT_PORT}-{DEFAULT_PORT+9}. All ports in use.")
        sys.exit(1)

    print(f"🚀 Trash Sorting Robot Gateway & Persistence Server running on http://localhost:{port}")
    print("Press Ctrl+C to stop.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shut down gracefully.")
        httpd.server_close()
        sys.exit(0)

if __name__ == '__main__':
    start_server()
