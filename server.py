# Andy local server -- run with: python server.py
import http.server
import socket
import webbrowser
import os
import sys

# Force UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = int(os.environ.get("PORT", 3000))

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress per-request logging

    def end_headers(self):
        self.send_header("Service-Worker-Allowed", "/")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

os.chdir(os.path.dirname(os.path.abspath(__file__)))

try:
    httpd = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
except OSError:
    print(f"\nERROR: Port {PORT} is already in use. Try: PORT=3001 python server.py\n")
    sys.exit(1)

local_ip = get_local_ip()

print(f"""
Andy is running!

  Desktop : http://localhost:{PORT}
  Mobile  : http://{local_ip}:{PORT}  (same WiFi network)

  To install as an app:
    Desktop : Chrome address bar -> Install icon  OR  menu -> "Install Andy..."
    Android : Chrome menu -> "Add to Home Screen"
    iOS     : Safari Share button -> "Add to Home Screen"

  Press Ctrl+C to stop.
""")

webbrowser.open(f"http://localhost:{PORT}")

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
