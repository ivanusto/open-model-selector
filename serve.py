import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run():
    os.chdir(DIRECTORY)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print("=" * 60)
        print(f"OpenModel Selector 本地服務已啟動！")
        print(f"網址：{url}")
        print(f"請在瀏覽器中操作。按 Ctrl+C 可停止伺服器。")
        print("=" * 60)
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 伺服器已停止。")
            sys.exit(0)

if __name__ == '__main__':
    run()
