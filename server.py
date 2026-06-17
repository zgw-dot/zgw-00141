import http.server
import socketserver
import os
import sys
import webbrowser
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
    os.chdir(Path(__file__).parent)
    
    Handler = CustomHTTPRequestHandler
    
    try:
        with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
            print("=" * 60)
            print("社区避难所物资签到系统 - 本地服务")
            print("=" * 60)
            print(f"服务地址: http://{HOST}:{PORT}")
            print(f"移动访问: 请在手机浏览器打开 http://{HOST}:{PORT}")
            print(f"工作目录: {os.getcwd()}")
            print("=" * 60)
            print("按 Ctrl+C 停止服务")
            print("=" * 60)
            print()
            
            try:
                webbrowser.open(f"http://{HOST}:{PORT}")
            except:
                pass
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n服务已停止")
        sys.exit(0)
    except OSError as e:
        if e.errno == 10048:
            print(f"端口 {PORT} 已被占用，请先停止占用该端口的进程")
            print(f"或者修改 server.py 中的 PORT 变量使用其他端口")
        else:
            print(f"启动错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
