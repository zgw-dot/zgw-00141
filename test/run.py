#!/usr/bin/env python3
"""
社区避难所物资签到系统 - 回归测试运行器

用法:
    python test/run.py          # 运行全部测试
    python test/run.py --headless   # 无头模式运行
    python test/run.py --port 8081  # 指定端口

依赖:
    pip install playwright
    playwright install chromium
"""

import sys
import os
import time
import json
import subprocess
import threading
import signal
import argparse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEST_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

def start_server(port=8080):
    """启动本地HTTP服务器（记录PID，确保只停止自己启动的进程）"""
    server_path = BASE_DIR / "server.py"
    cmd = [sys.executable, str(server_path), "--port", str(port), "--no-browser"]
    
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    
    proc = subprocess.Popen(
        cmd,
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env
    )
    
    pid = proc.pid
    print(f"   [PID: {pid}] 正在启动...")
    
    time.sleep(2)
    
    if proc.poll() is not None:
        output = proc.stdout.read() if proc.stdout else ""
        raise RuntimeError(f"服务器启动失败 (PID {pid}): {output}")
    
    return proc

def stop_server(proc):
    """停止服务器（仅停止本脚本启动的进程）"""
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except:
            try:
                proc.kill()
                proc.wait(timeout=3)
            except:
                pass

def run_tests(port=8080, headless=False):
    """使用Playwright运行回归测试"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("❌ 未安装 playwright")
        print("请先执行: pip install playwright && playwright install chromium")
        return None
    
    test_url = f"http://localhost:{port}/test/regression.html"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            locale="zh-CN"
        )
        page = context.new_page()
        
        messages = []
        errors = []
        
        def on_console(msg):
            text = msg.text
            messages.append(text)
            if msg.type == "error":
                errors.append(text)
                print(f"  [浏览器错误] {text}")
        
        page.on("console", on_console)
        
        print(f"\n📂 打开测试页面: {test_url}")
        page.goto(test_url, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        
        print("▶  开始执行测试...\n")
        page.evaluate("window.runAllTests()")
        
        start_time = time.time()
        max_wait = 90
        
        summary = None
        while time.time() - start_time < max_wait:
            summary = page.evaluate("() => { "
                "const summaryEl = document.getElementById('summary'); "
                "if (!summaryEl || !summaryEl.classList.contains('show')) return null; "
                "return { "
                "total: parseInt(document.getElementById('total').textContent), "
                "passed: parseInt(document.getElementById('passed').textContent), "
                "failed: parseInt(document.getElementById('failed').textContent), "
                "duration: parseInt(document.getElementById('duration').textContent) "
                "}; "
            "}")
            
            if summary:
                break
            
            page.wait_for_timeout(1000)
        
        test_results = []
        items = page.query_selector_all(".test-item")
        for item in items:
            name = item.query_selector(".test-name")
            status = item.query_selector(".test-status")
            duration = item.query_selector(".test-duration")
            error = item.query_selector(".test-error")
            
            test_results.append({
                "name": name.inner_text() if name else "",
                "passed": "通过" in (status.inner_text() if status else ""),
                "duration": duration.inner_text() if duration else "",
                "error": error.inner_text() if error else None
            })
        
        summary = page.evaluate("() => { "
            "const summary = document.getElementById('summary'); "
            "if (!summary || !summary.classList.contains('show')) return null; "
            "return { "
            "total: parseInt(document.getElementById('total').textContent), "
            "passed: parseInt(document.getElementById('passed').textContent), "
            "failed: parseInt(document.getElementById('failed').textContent), "
            "duration: parseInt(document.getElementById('duration').textContent) "
            "}; "
        "}")
        
        browser.close()
        
        return {
            "summary": summary,
            "tests": test_results,
            "console_messages": messages
        }

def print_results(results):
    """打印测试结果"""
    if not results:
        print("\n❌ 测试执行失败")
        return False
    
    summary = results["summary"]
    tests = results["tests"]
    
    print("\n" + "=" * 50)
    print("  🧪 回归测试结果")
    print("=" * 50)
    
    if summary:
        print(f"\n  总用例: {summary['total']}")
        print(f"  ✅ 通过: {summary['passed']}")
        print(f"  ❌ 失败: {summary['failed']}")
        print(f"  ⏱  耗时: {summary['duration']}ms")
    else:
        print("\n  ⚠️  未获取到汇总结果")
    
    print("\n" + "-" * 50)
    
    current_scenario = ""
    for test in tests:
        name = test["name"]
        
        if name.startswith("1.") and current_scenario != "场景1":
            current_scenario = "场景1"
            print("\n📦 场景1: 物资配置持久化测试")
        elif name.startswith("2.") and current_scenario != "场景2":
            current_scenario = "场景2"
            print("\n⚡ 场景2: 冲突队列保留测试")
        elif name.startswith("3.") and current_scenario != "场景3":
            current_scenario = "场景3"
            print("\n📅 场景3: 导出页默认日期测试")
        
        status_icon = "✅" if test["passed"] else "❌"
        print(f"  {status_icon} {name} ({test['duration']})")
        
        if test["error"]:
            print(f"     错误: {test['error']}")
    
    print("\n" + "=" * 50)
    
    if summary:
        all_passed = summary["failed"] == 0
        if all_passed:
            print("  🎉 全部测试通过!")
        else:
            print(f"  ⚠️  有 {summary['failed']} 个测试失败")
        print("=" * 50 + "\n")
        return all_passed
    
    print("=" * 50 + "\n")
    return False

def main():
    parser = argparse.ArgumentParser(description="社区避难所物资签到系统 - 回归测试")
    parser.add_argument("--port", type=int, default=8080, help="本地服务端口 (默认: 8080)")
    parser.add_argument("--headless", action="store_true", help="无头模式运行")
    parser.add_argument("--no-server", action="store_true", help="不启动服务器，使用已有服务")
    args = parser.parse_args()
    
    server_proc = None
    
    def signal_handler(sig, frame):
        print("\n\n🛑 收到中断信号，正在清理...")
        if server_proc:
            stop_server(server_proc)
        sys.exit(1)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        if not args.no_server:
            print(f"🚀 启动本地服务 (端口 {args.port})...")
            server_proc = start_server(args.port)
            print("   ✓ 服务已启动")
        
        results = run_tests(port=args.port, headless=args.headless)
        
        all_passed = print_results(results)
        
        if not args.no_server and server_proc:
            stop_server(server_proc)
            server_proc = None
            print("   ✓ 服务已停止")
        
        sys.exit(0 if all_passed else 1)
        
    except Exception as e:
        print(f"\n❌ 执行出错: {e}")
        import traceback
        traceback.print_exc()
        
        if server_proc:
            stop_server(server_proc)
        
        sys.exit(1)

if __name__ == "__main__":
    main()
