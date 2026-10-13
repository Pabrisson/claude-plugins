#!/usr/bin/env python3
"""
Claude Code Notify
https://github.com/dazuiba/CCNotify
"""

import os
import sys
import re
import json
import shlex
import shutil
import sqlite3
import subprocess
import logging
import xml.etree.ElementTree as ET
from pathlib import Path
from logging.handlers import TimedRotatingFileHandler
from datetime import datetime


# the plugin's data dir survives updates, unlike the plugin root
DATA_DIR = os.environ.get("CLAUDE_PLUGIN_DATA") or os.path.dirname(os.path.abspath(__file__))
ICON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")
HAS_ICON = os.path.exists(ICON)

# Windows PowerShell 5.1 toast; the XML comes from an env var so nothing needs quoting
PS_TOAST = (
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;"
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;"
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument;"
    "$x.LoadXml($env:CCNOTIFY_TOAST);"
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')"
    ".Show([Windows.UI.Notifications.ToastNotification]::new($x))"
)


def excerpt(text, limit):
    """One line, light markdown stripped, cut to limit chars"""
    text = " ".join(re.sub(r"[*`#]", "", text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def project_name(cwd):
    """Folder name, or a generic label when Claude runs from the home dir"""
    if not cwd or os.path.normcase(os.path.abspath(cwd)) == os.path.normcase(os.path.expanduser("~")):
        return "Claude Code"
    return os.path.basename(os.path.normpath(cwd))


def toast_xml(title, subtitle, message):
    """ToastGeneric payload: one <text> per line, Claude logo instead of the PowerShell icon"""
    toast = ET.Element("toast")
    binding = ET.SubElement(ET.SubElement(toast, "visual"), "binding", template="ToastGeneric")
    for text in (title, subtitle, message):
        if text:
            ET.SubElement(binding, "text").text = text
    # a Linux path (WSL) isn't readable by Windows, so the logo is native Windows only
    if sys.platform == "win32" and HAS_ICON:
        ET.SubElement(binding, "image", placement="appLogoOverride", src=Path(ICON).as_uri())
    return ET.tostring(toast, encoding="unicode")


def notification_commands(title, subtitle, message, cwd):
    """Candidate notifiers for this OS, in order of preference"""
    if sys.platform == "darwin":
        notifier = ["terminal-notifier", "-sound", "default", "-title", title, "-message", message]
        if subtitle:
            notifier += ["-subtitle", subtitle]
        if HAS_ICON:
            notifier += ["-contentImage", ICON]
        code = shutil.which("code")
        if cwd and code:
            notifier += ["-execute", f"{shlex.quote(code)} {shlex.quote(cwd)}"]
        osascript = [
            "osascript",
            "-e", "on run argv",
            "-e", 'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv) sound name "default"',
            "-e", "end run",
            title, subtitle, message,
        ]
        return [notifier, osascript]
    # Linux, then Windows / WSL
    return [
        ["notify-send", *(["-i", ICON] if HAS_ICON else []), title, "\n".join(filter(None, [subtitle, message]))],
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", PS_TOAST],
    ]


class ClaudePromptTracker:
    def __init__(self):
        """Initialize the prompt tracker with database setup"""
        os.makedirs(DATA_DIR, exist_ok=True)
        self.db_path = os.path.join(DATA_DIR, "ccnotify.db")
        self.setup_logging()
        self.init_database()

    def setup_logging(self):
        """Setup logging to file with daily rotation"""

        log_path = os.path.join(DATA_DIR, "ccnotify.log")

        # Create a timed rotating file handler
        handler = TimedRotatingFileHandler(
            log_path,
            when="midnight",  # Rotate at midnight
            interval=1,  # Every 1 day
            backupCount=1,  # Keep 1 days of logs
            encoding="utf-8",
        )

        # Set the log format
        formatter = logging.Formatter(
            "%(asctime)s - %(levelname)s - %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
        handler.setFormatter(formatter)

        # Configure the root logger
        logger = logging.getLogger()
        logger.setLevel(logging.INFO)
        logger.addHandler(handler)

    def init_database(self):
        """Create tables and triggers if they don't exist"""
        with sqlite3.connect(self.db_path) as conn:
            # Create main table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS prompt (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    prompt TEXT,
                    cwd TEXT,
                    seq INTEGER,
                    stoped_at DATETIME,
                    lastWaitUserAt DATETIME
                )
            """)

            # Create trigger for auto-incrementing seq
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS auto_increment_seq
                AFTER INSERT ON prompt
                FOR EACH ROW
                BEGIN
                    UPDATE prompt
                    SET seq = (
                        SELECT COALESCE(MAX(seq), 0) + 1
                        FROM prompt
                        WHERE session_id = NEW.session_id
                    )
                    WHERE id = NEW.id;
                END
            """)

            conn.commit()

    def handle_user_prompt_submit(self, data):
        """Handle UserPromptSubmit event - insert new prompt record"""
        session_id = data.get("session_id")
        prompt = data.get("prompt", "")
        cwd = data.get("cwd", "")

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO prompt (session_id, prompt, cwd)
                VALUES (?, ?, ?)
            """,
                (session_id, prompt, cwd),
            )
            conn.commit()

        logging.info(f"Recorded prompt for session {session_id}")

    def handle_stop(self, data):
        """Handle Stop event - update completion time and send notification"""
        session_id = data.get("session_id")

        with sqlite3.connect(self.db_path) as conn:
            # Find the latest unfinished record for this session
            cursor = conn.execute(
                """
                SELECT id, created_at, cwd, prompt
                FROM prompt
                WHERE session_id = ? AND stoped_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            """,
                (session_id,),
            )

            row = cursor.fetchone()
            if row:
                record_id, created_at, cwd, prompt = row

                # Update completion time
                conn.execute(
                    """
                    UPDATE prompt
                    SET stoped_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """,
                    (record_id,),
                )
                conn.commit()

                # Get seq number and calculate duration
                cursor = conn.execute(
                    "SELECT seq FROM prompt WHERE id = ?", (record_id,)
                )
                seq_row = cursor.fetchone()
                seq = seq_row[0] if seq_row else 1

                duration = self.calculate_duration_from_db(record_id)
                # terminal-notifier requires a non-empty message
                self.send_notification(
                    title=f"{project_name(cwd)} · job#{seq} ✓ {duration}",
                    subtitle="› " + excerpt(prompt, 80) if prompt else "",
                    message=excerpt(data.get("last_assistant_message"), 150) or "Done",
                    cwd=cwd,
                )

                logging.info(
                    f"Task completed for session {session_id}, job#{seq}, duration: {duration}"
                )

    def handle_notification(self, data):
        """Handle Notification event - check for various notification types and send notifications"""
        session_id = data.get("session_id")
        message = data.get("message", "")
        cwd = data.get("cwd", "")

        # Log all notifications for debugging
        logging.info(f"[NOTIFICATION] session={session_id}, message='{message}'")

        # Determine notification type and subtitle
        message_lower = message.lower()
        subtitle = None
        should_update_db = False
        should_notify = True

        if (
            "waiting for your input" in message_lower
            or "waiting for input" in message_lower
        ):
            subtitle = "Waiting for input"
            should_update_db = True
            should_notify = (
                False  # Suppress notification - Stop handler will send "job done"
            )
        elif "permission" in message_lower:
            subtitle = "Permission Required"
        elif "approval" in message_lower or "choose an option" in message_lower:
            subtitle = "Action Required"
        else:
            # For other notifications, use a generic subtitle
            subtitle = "Notification"

        # Update database for waiting notifications
        if should_update_db:
            with sqlite3.connect(self.db_path) as conn:
                # Fix: Use subquery instead of ORDER BY/LIMIT in UPDATE
                conn.execute(
                    """
                    UPDATE prompt
                    SET lastWaitUserAt = CURRENT_TIMESTAMP
                    WHERE id = (
                        SELECT id FROM prompt
                        WHERE session_id = ?
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                """,
                    (session_id,),
                )
                conn.commit()
            logging.info(f"Updated lastWaitUserAt for session {session_id}")

        # Send notification only if should_notify is True
        if should_notify:
            self.send_notification(
                title=f"{project_name(cwd)} · {data.get('title') or subtitle}",
                subtitle="",
                message=excerpt(message, 150) or subtitle,
                cwd=cwd,
            )
            logging.info(f"Notification sent for session {session_id}: {subtitle}")
        else:
            logging.info(
                f"Notification suppressed for session {session_id}: {subtitle}"
            )

    def calculate_duration_from_db(self, record_id):
        """Calculate duration for a completed record"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                SELECT created_at, stoped_at
                FROM prompt
                WHERE id = ?
            """,
                (record_id,),
            )

            row = cursor.fetchone()
            if row and row[1]:
                return self.calculate_duration(row[0], row[1])

        return "Unknown"

    def calculate_duration(self, start_time, end_time):
        """Calculate human-readable duration between two timestamps"""
        try:
            if isinstance(start_time, str):
                start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            else:
                start_dt = datetime.fromisoformat(start_time)

            if isinstance(end_time, str):
                end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            else:
                end_dt = datetime.fromisoformat(end_time)

            duration = end_dt - start_dt
            total_seconds = int(duration.total_seconds())

            if total_seconds < 60:
                return f"{total_seconds}s"
            elif total_seconds < 3600:
                minutes = total_seconds // 60
                seconds = total_seconds % 60
                if seconds > 0:
                    return f"{minutes}m{seconds}s"
                else:
                    return f"{minutes}m"
            else:
                hours = total_seconds // 3600
                minutes = (total_seconds % 3600) // 60
                if minutes > 0:
                    return f"{hours}h{minutes}m"
                else:
                    return f"{hours}h"
        except Exception as e:
            logging.error(f"Error calculating duration: {e}")
            return "Unknown"

    def send_notification(self, title, subtitle, message, cwd=None):
        """Send a desktop notification with the first notifier that works on this OS"""
        env = {
            **os.environ,
            "CCNOTIFY_TOAST": toast_xml(title, subtitle, message),
            # forwards the var to powershell.exe when running under WSL
            "WSLENV": ":".join(filter(None, [os.environ.get("WSLENV"), "CCNOTIFY_TOAST"])),
        }

        for cmd in notification_commands(title, subtitle, message, cwd):
            if not shutil.which(cmd[0]):
                continue
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    errors="replace",
                    env=env,
                    timeout=10,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except Exception as e:
                logging.error(f"{cmd[0]} failed: {e}")
                continue
            if result.stderr.strip():
                logging.warning(f"{cmd[0]} stderr: {result.stderr.strip()}")
            if result.returncode == 0:
                logging.info(f"Notification sent via {cmd[0]}: {title} | {subtitle} | {message}")
                return
            # e.g. an Intel-only terminal-notifier on Apple Silicon: try the next one
            logging.warning(f"{cmd[0]} exited {result.returncode}, trying next notifier")

        logging.warning("No working notifier, notification skipped")


def validate_input_data(data, expected_event_name):
    """Validate input data matches design specification"""
    required_fields = {
        "UserPromptSubmit": ["session_id", "prompt", "cwd", "hook_event_name"],
        "Stop": ["session_id", "hook_event_name"],
        "Notification": ["session_id", "message", "hook_event_name"],
    }

    if expected_event_name not in required_fields:
        raise ValueError(f"Unknown event type: {expected_event_name}")

    # Check hook_event_name matches expected
    if data.get("hook_event_name") != expected_event_name:
        raise ValueError(
            f"Event name mismatch: expected {expected_event_name}, got {data.get('hook_event_name')}"
        )

    # Check required fields
    missing_fields = []
    for field in required_fields[expected_event_name]:
        if field not in data or data[field] is None:
            missing_fields.append(field)

    if missing_fields:
        raise ValueError(
            f"Missing required fields for {expected_event_name}: {missing_fields}"
        )

    return True


def main():
    """Main entry point - read JSON from stdin and process event"""
    try:
        # Check if hook type is provided as command line argument
        if len(sys.argv) < 2:
            print("ok")
            return

        expected_event_name = sys.argv[1]
        valid_events = ["UserPromptSubmit", "Stop", "Notification"]

        if expected_event_name not in valid_events:
            logging.error(f"Invalid hook type: {expected_event_name}")
            logging.error(f"Valid hook types: {', '.join(valid_events)}")
            sys.exit(1)

        # Read raw bytes: Windows' default stdin encoding isn't UTF-8
        input_data = sys.stdin.buffer.read().strip()
        if not input_data:
            logging.warning("No input data received")
            return

        data = json.loads(input_data)

        # Validate input data
        validate_input_data(data, expected_event_name)

        tracker = ClaudePromptTracker()

        if expected_event_name == "UserPromptSubmit":
            tracker.handle_user_prompt_submit(data)
        elif expected_event_name == "Stop":
            tracker.handle_stop(data)
        elif expected_event_name == "Notification":
            tracker.handle_notification(data)

    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error: {e}")
        sys.exit(1)
    except ValueError as e:
        logging.error(f"Validation error: {e}")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()