#!/usr/bin/env python3
"""
Database Management Module for Trash Sorting Robot Monitoring.
Handles SQLite database persistence for bin capacities, detection logs, and system alerts.
Includes automatic cleanup for records older than 2 days to prevent data bloat.
"""

import sqlite3
import os
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trashbot.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def auto_cleanup_old_logs(days=2):
    """Automatically purges detection logs and system alerts older than specified days."""
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM detection_logs WHERE created_at < datetime('now', ?)", (f'-{days} days',))
            cursor.execute("DELETE FROM system_alerts WHERE created_at < datetime('now', ?)", (f'-{days} days',))
            conn.commit()
            print(f"🧹 Auto-cleanup executed: purged records older than {days} days.")
    except Exception as e:
        print("⚠️ Auto-cleanup warning:", e)

def clear_all_data():
    """Resets all bin counts to 0, clears detection logs, and system alerts."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE bin_capacities SET count = 0, status = 'Normal', updated_at = CURRENT_TIMESTAMP")
        cursor.execute("DELETE FROM detection_logs")
        cursor.execute("DELETE FROM system_alerts")
        conn.commit()
        print("🧼 All trash bin capacities and logs have been reset to 0.")

def init_db():
    """Initializes SQLite database tables if they do not exist."""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Bin Capacities Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bin_capacities (
            category TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            count INTEGER DEFAULT 0,
            max_capacity INTEGER DEFAULT 50,
            status TEXT DEFAULT 'Normal',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # Default bins
        default_bins = [
            ('plastic', 'Botol Plastik', 0, 50, 'Normal'),
            ('paper', 'Kertas', 0, 50, 'Normal'),
            ('can', 'Kaleng', 0, 50, 'Normal'),
            ('unknown', 'Unknown', 0, 50, 'Normal')
        ]
        for b in default_bins:
            cursor.execute("""
            INSERT OR IGNORE INTO bin_capacities (category, name, count, max_capacity, status)
            VALUES (?, ?, ?, ?, ?)
            """, b)

        # Ensure name is updated if table already exists
        cursor.execute("UPDATE bin_capacities SET name = 'Botol Plastik' WHERE category = 'plastic'")

        # 2. Detection Logs Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS detection_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time_str TEXT NOT NULL,
            item_name TEXT NOT NULL,
            category TEXT NOT NULL,
            size TEXT DEFAULT 'Sedang',
            confidence REAL DEFAULT 95.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 3. System Alerts Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time_str TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        conn.commit()
    
    # Run auto cleanup for records older than 2 days on startup
    auto_cleanup_old_logs(2)
    print("✅ Database initialized successfully:", DB_PATH)

def get_bin_capacities():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT category, name, count, max_capacity as max, status FROM bin_capacities")
        rows = cursor.fetchall()
        result = {}
        for row in rows:
            result[row['category']] = {
                'name': row['name'],
                'count': row['count'],
                'max': row['max'],
                'status': row['status']
            }
        return result

def add_trash_item(category, item_name, size='Sedang', confidence=95.0):
    now = time.strftime('%H:%M:%S')
    key_map = {
        'Plastik': 'plastic', 'plastic': 'plastic',
        'Kertas': 'paper', 'paper': 'paper',
        'Kaleng': 'can', 'can': 'can',
        'Unknown': 'unknown', 'unknown': 'unknown'
    }
    bin_key = key_map.get(category, 'unknown')

    with get_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Insert into detection_logs
        cursor.execute("""
        INSERT INTO detection_logs (time_str, item_name, category, size, confidence)
        VALUES (?, ?, ?, ?, ?)
        """, (now, item_name, bin_key, size, confidence))

        # 2. Update bin_capacities count
        cursor.execute("SELECT count, max_capacity FROM bin_capacities WHERE category = ?", (bin_key,))
        row = cursor.fetchone()
        if row:
            current_count = row['count']
            max_cap = row['max_capacity']
            new_count = min(current_count + 1, max_cap)
            
            # Evaluate status
            pct = (new_count / max_cap) * 100
            new_status = 'Penuh' if pct >= 100 else ('Hampir Penuh' if pct >= 80 else 'Normal')
            
            cursor.execute("""
            UPDATE bin_capacities SET count = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?
            """, (new_count, new_status, bin_key))

        conn.commit()

def reset_bin(category):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE bin_capacities SET count = 0, status = 'Normal', updated_at = CURRENT_TIMESTAMP WHERE category = ?
        """, (category,))
        conn.commit()

def set_bin_max(category, max_capacity):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count FROM bin_capacities WHERE category = ?", (category,))
        row = cursor.fetchone()
        if row:
            cnt = row['count']
            pct = (cnt / int(max_capacity)) * 100
            new_status = 'Penuh' if pct >= 100 else ('Hampir Penuh' if pct >= 80 else 'Normal')
            cursor.execute("""
            UPDATE bin_capacities SET max_capacity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?
            """, (int(max_capacity), new_status, category))
        conn.commit()

def get_recent_detections(limit=50):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, time_str as time, item_name as name, category, size, confidence 
        FROM detection_logs ORDER BY id DESC LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def add_system_alert(alert_type, title, message):
    now = time.strftime('%H:%M:%S')
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO system_alerts (time_str, alert_type, title, message)
        VALUES (?, ?, ?, ?)
        """, (now, alert_type, title, message))
        conn.commit()

def get_recent_alerts(limit=30):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, alert_type as type, title, message, time_str as time 
        FROM system_alerts ORDER BY id DESC LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

if __name__ == "__main__":
    init_db()
