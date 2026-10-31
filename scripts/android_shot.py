"""CDP 截图：可选先执行一段 JS（用来切 tab），再截图。

用法：python .tools/cdp_eval_shot.py <out.png> ["js 表达式"]
"""
import base64
import json
import sys
import time
import urllib.request

import websocket

out = sys.argv[1] if len(sys.argv) > 1 else ".demo/mobile.png"
js = sys.argv[2] if len(sys.argv) > 2 else ""

targets = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
pages = [t for t in targets if t.get("type") == "page"]
if not pages:
    print("NO_PAGE", json.dumps(targets)[:400])
    sys.exit(2)
page = pages[0]
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)

mid = 0


def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid:
            return msg


send("Page.enable")
print("URL", page.get("url"), "TITLE", page.get("title"))

if js:
    r = send("Runtime.evaluate", {"expression": js, "awaitPromise": True, "returnByValue": True})
    print("EVAL", json.dumps(r.get("result", {}))[:400])
    time.sleep(0.9)

r = send("Page.captureScreenshot", {"format": "png"})
data = r.get("result", {}).get("data")
if data:
    with open(out, "wb") as f:
        f.write(base64.b64decode(data))
    print("SAVED", out, len(data))
else:
    print("FAILED", json.dumps(r)[:600])
    sys.exit(1)
