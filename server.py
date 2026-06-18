import http.server
import socketserver
import os
import sys
import webbrowser
import argparse
import json
import urllib.parse
from pathlib import Path
from datetime import datetime

PORT = 8080
HOST = "localhost"

EXPORTS_DIR = Path(__file__).parent / "exports"
EXPORTS_DIR.mkdir(exist_ok=True)

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

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path == '/api/export':
            self._handle_export_save()
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')

    def _handle_export_save(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))
            
            filename = data.get('filename', f'export_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
            content = data.get('content', '')
            export_type = data.get('type', 'unknown')
            batch_id = data.get('batchId')
            operator = data.get('operator', {})
            
            safe_filename = "".join(c for c in filename if c.isalnum() or c in ('-', '_', '.', '(', ')'))
            if not safe_filename.endswith(('.csv', '.json', '.txt')):
                safe_filename += '.txt'
            
            type_dir = EXPORTS_DIR / export_type
            type_dir.mkdir(exist_ok=True)
            
            filepath = type_dir / safe_filename
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            manifest = {
                'filename': safe_filename,
                'exportType': export_type,
                'batchId': batch_id,
                'operator': operator,
                'timestamp': datetime.now().isoformat(),
                'sizeBytes': len(content),
                'filepath': str(filepath.relative_to(Path(__file__).parent))
            }
            
            manifest_path = type_dir / f"{safe_filename}.manifest.json"
            with open(manifest_path, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            response = {
                'success': True,
                'filepath': str(filepath),
                'manifest': manifest
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            
            print(f"[导出落盘] {export_type}: {safe_filename} | 操作人: {operator.get('name', '未知')} | 大小: {len(content)} bytes")
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            error_response = {'success': False, 'error': str(e)}
            self.wfile.write(json.dumps(error_response, ensure_ascii=False).encode('utf-8'))
            print(f"[导出落盘失败] {e}", file=sys.stderr)

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
