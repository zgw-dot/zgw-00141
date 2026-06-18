import http.server
import socketserver
import os
import sys
import webbrowser
import argparse
from pathlib import Path

PORT = 8080
HOST = "localhost"

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).parent), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

def main():
    parser = argparse.ArgumentParser(description="社区避难所物资签到系统 - 本地服务")
    parser.add_argument("--port", type=int, default=PORT, help=f"监听端口 (默认: {PORT})")
    parser.add_argument("--host", type=str, default=HOST, help=f"监听地址 (默认: {HOST})")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()
    
    port = args.port
    host = args.host
    
    os.chdir(Path(__file__).parent)
    
    Handler = CustomHTTPRequestHandler
    
    try:
        socketserver.TCPServer.allow_reuse_address = True
        with socketserver.TCPServer((host, port), Handler) as httpd:
            print("=" * 60)
            print("社区避难所物资签到系统 - 本地服务")
            print("=" * 60)
            print(f"服务地址: http://{host}:{port}")
            print(f"工作目录: {os.getcwd()}")
            print("=" * 60)
            print("按 Ctrl+C 停止服务")
            print("=" * 60)
            print(f"[PID: {os.getpid()}] 服务已启动", flush=True)
            
            if not args.no_browser:
                try:
                    webbrowser.open(f"http://{host}:{port}")
                except:
                    pass
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n服务已停止")
        sys.exit(0)
    except OSError as e:
        if e.errno == 10048:
            print(f"端口 {port} 已被占用，请先停止占用该端口的进程")
        else:
            print(f"启动错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
