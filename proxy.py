# /// script
# requires-python = ">=3.10"
# dependencies = ["curl_cffi", "python-dotenv"]
# ///
"""Proxy entrypoint. All logic lives in the sibling `proxy_*` modules."""

from proxy_server import main

if __name__ == "__main__":
    main()
