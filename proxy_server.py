"""Proxy process lifecycle: port selection, port-file handoff, serving."""

import os
import socket
from http.server import HTTPServer

import proxy_config
from proxy_handler import ProxyHandler


def find_free_port(preferred=0):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", preferred))
        except OSError:
            s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    preferred = int(os.environ.get("R34_PROXY_PORT", "0"))
    port = find_free_port(preferred)
    server = HTTPServer(("127.0.0.1", port), ProxyHandler)
    with open(proxy_config.PORT_FILE, "w") as f:
        f.write(str(port))
    print(f"proxy:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        try:
            os.remove(proxy_config.PORT_FILE)
        except OSError:
            pass
