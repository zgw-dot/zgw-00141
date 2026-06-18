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
        elif parsed_path.path == '/api/handoff/persist':
            self._handle_generic_save('handoff_tickets', '交接票')
        elif parsed_path.path == '/api/failed_records/save':
            self._handle_generic_save('failed_records', '失败明细')
        elif parsed_path.path == '/api/permission_denials/save':
            self._handle_generic_save('permission_denials', '权限拒绝记录')
        elif parsed_path.path == '/api/export_manifest/save':
            self._handle_generic_save('export_manifests', '导出清单')
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')

    def _handle_export_save(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            filename = data.get('filename') or data.get('fileName') or f'export_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
            content = data.get('content') or data.get('data') or ''
            export_type = data.get('type') or data.get('format') or data.get('exportType') or 'unknown'
            batch_id = data.get('batchId')
            operator = data.get('operator') or {
                'id': data.get('exportedBy') or data.get('createdBy'),
                'name': data.get('exportedByName') or data.get('createdByName') or '未知'
            }
            signature = data.get('signature') or {}
            recordCount = data.get('recordCount') or 0
            
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
                'fileName': safe_filename,
                'exportType': export_type,
                'format': export_type,
                'batchId': batch_id,
                'operator': operator,
                'signature': signature,
                'recordCount': recordCount,
                'timestamp': datetime.now().isoformat(),
                'sizeBytes': len(content),
                'fileSize': len(content),
                'filepath': str(filepath.relative_to(Path(__file__).parent)),
                'filePath': str(filepath.relative_to(Path(__file__).parent)),
                'absolutePath': str(filepath)
            }

            manifest_path = type_dir / f"{safe_filename}.manifest.json"
            with open(manifest_path, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()

            rel_download = manifest['filepath'].replace('\\', '/')
            response = {
                'success': True,
                'filepath': str(filepath),
                'filePath': str(filepath.relative_to(Path(__file__).parent)),
                'manifestFilePath': str(manifest_path.relative_to(Path(__file__).parent)),
                'downloadUrl': '/' + rel_download,
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

    def _handle_generic_save(self, default_type: str, label: str):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            filename = (data.get('filename') or data.get('fileName')
                        or f"{default_type}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]}.json")
            store_type = data.get('type') or data.get('storeType') or default_type
            batch_id = data.get('batchId')
            ticket_id = data.get('ticketId') or data.get('handoffTicketId')
            denial_id = data.get('denialId') or f"denial_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]}"
            export_id = data.get('exportId') or None

            operator = data.get('operator') or {
                'id': data.get('userId') or data.get('exportedBy') or data.get('createdBy'),
                'name': data.get('userName') or data.get('exportedByName') or data.get('createdByName') or '未知',
                'role': data.get('userRole') or data.get('role') or 'unknown'
            }
            action = data.get('action') or data.get('operationType') or label
            reason = data.get('reason') or ''

            safe_filename = "".join(c for c in filename if c.isalnum() or c in ('-', '_', '.', '(', ')'))
            if not safe_filename.endswith(('.json', '.txt', '.csv')):
                safe_filename += '.json'

            type_dir = EXPORTS_DIR / store_type
            type_dir.mkdir(exist_ok=True)
            filepath = type_dir / safe_filename

            raw_content = data.get('content') or data.get('data')
            if raw_content is None:
                payload = {**data, '_savedAt': datetime.now().isoformat()}
            else:
                payload = raw_content
            content_str = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, indent=2)

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content_str)

            manifest = {
                'filename': safe_filename,
                'fileName': safe_filename,
                'storeType': store_type,
                'type': store_type,
                'label': label,
                'batchId': batch_id,
                'ticketId': ticket_id,
                'denialId': denial_id,
                'exportId': export_id,
                'action': action,
                'reason': reason,
                'operator': operator,
                'timestamp': datetime.now().isoformat(),
                'sizeBytes': len(content_str),
                'fileSize': len(content_str),
                'filepath': str(filepath.relative_to(Path(__file__).parent)),
                'filePath': str(filepath.relative_to(Path(__file__).parent)),
                'absolutePath': str(filepath)
            }

            manifest_path = EXPORTS_DIR / f"_manifest_{store_type}.jsonl"
            with open(manifest_path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(manifest, ensure_ascii=False) + '\n')

            per_file_manifest = type_dir / f"{safe_filename}.manifest.json"
            with open(per_file_manifest, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()

            response = {
                'success': True,
                'filepath': str(filepath),
                'filePath': str(filepath.relative_to(Path(__file__).parent)),
                'manifestFilePath': str(per_file_manifest.relative_to(Path(__file__).parent)),
                'denialId': denial_id,
                'ticketId': ticket_id,
                'exportId': export_id,
                'manifest': manifest
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

            print(f"[{label}落盘] {store_type}: {safe_filename} | 操作人: {operator.get('name', '未知')} | 大小: {len(content_str)} bytes")

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            error_response = {'success': False, 'error': str(e)}
            self.wfile.write(json.dumps(error_response, ensure_ascii=False).encode('utf-8'))
            print(f"[{label}落盘失败] {e}", file=sys.stderr)

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
