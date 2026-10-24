#!/usr/bin/env python3
"""Check the public Sites deployment without cookies, tokens, or real user data.

This intentionally performs only reads and anonymous writes that must be denied.
It does not exercise signed-in persistence or claim to prove the R2/D1 bindings
work beyond their advertised availability; those require an authenticated test.
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="Published HTTPS Site URL")
    parser.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("Provide an HTTPS site origin without credentials, query, or fragment.")
    if parsed.path not in ("", "/"):
        parser.error("Provide the site origin, without an application path.")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    opener = urllib.request.build_opener(NoRedirect)
    findings = []

    def request(path, method="GET", payload=None, extra_headers=None):
        headers = {"Accept": "application/json", "User-Agent": "ImpactLens-Anonymous-Security-Smoke/1.0"}
        if extra_headers:
            headers.update(extra_headers)
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers.update({"Content-Type": "application/json", "Origin": origin})
        req = urllib.request.Request(origin + path, data=data, method=method, headers=headers)
        try:
            response = opener.open(req, timeout=args.timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(2_097_153)
            assert len(body) <= 2_097_152, "Unexpectedly large response"
            return response.status, response.headers, body

    def private_headers(headers):
        cache = headers.get("Cache-Control", "").lower()
        assert "private" in cache and "no-store" in cache, "Missing private/no-store cache policy"
        assert headers.get("X-Content-Type-Options", "").lower() == "nosniff", "Missing nosniff response header"

    def check(name, action):
        try:
            action()
            findings.append({"check": name, "passed": True})
            print(f"PASS: {name}")
        except Exception as error:
            # Never print response bodies, identity values, or credentials.
            findings.append({"check": name, "passed": False, "reason": str(error)})
            print(f"FAIL: {name}: {error}")

    def session(extra_headers=None):
        status, headers, body = request("/api/session", extra_headers=extra_headers)
        assert status == 200, f"Expected HTTP 200; received {status}"
        private_headers(headers)
        value = json.loads(body)
        assert value.get("authenticated") is False, "Anonymous caller was treated as authenticated"
        assert value.get("user") is None, "Anonymous session returned a user"
        assert value.get("storageAvailable") is True, "Deployment does not advertise both private storage bindings"
        assert value.get("signInUrl", "").startswith("/signin-with-chatgpt?"), "Hosted sign-in route is missing"

    def protected(path, method="GET", payload=None, extra_headers=None):
        status, headers, body = request(path, method, payload, extra_headers)
        assert status == 401, f"Expected HTTP 401; received {status}"
        private_headers(headers)
        value = json.loads(body)
        assert value.get("code") == "SIGN_IN_REQUIRED", "Expected the sign-in-required error"
        assert "projects" not in value and "rows" not in value and "reports" not in value, "Private data leaked in unauthorized response"

    def official_data():
        status, _, body = request("/data/official.json")
        assert status == 200, f"Expected HTTP 200; received {status}"
        actual = json.loads(body)
        expected = json.loads((Path(__file__).resolve().parents[1] / "public/data/official.json").read_text())
        assert len(actual) == 38, f"Expected 38 public official rows; received {len(actual)}"
        assert actual == expected, "Published official rows differ from reviewed canonical data"

    check("anonymous session remains public and does not authenticate", session)
    check("public official dataset matches all 38 reviewed rows", official_data)
    check("anonymous project listing is denied with private cache policy", lambda: protected("/api/projects"))
    project_id = "00000000-0000-4000-8000-000000000001"
    report_id = "00000000-0000-4000-8000-000000000002"
    for suffix in ("", "/analysis", "/reports"):
        check(f"anonymous project{suffix or '/detail'} request is denied", lambda suffix=suffix: protected(f"/api/projects/{project_id}{suffix}"))
    check("anonymous report download is denied", lambda: protected(f"/api/reports/{report_id}/download?format=json"))
    check("anonymous empty project mutation is denied", lambda: protected("/api/projects", "POST", {}))
    check("anonymous empty report mutation is denied", lambda: protected(f"/api/projects/{project_id}/reports", "POST", {}))
    spoofed = {"oai-authenticated-user-id": "impactlens-anonymous-smoke-not-a-real-user", "oai-authenticated-user-email": "anonymous-smoke@example.invalid"}
    check("Sites Dispatch ignores forged identity headers in session", lambda: session(spoofed))
    check("forged identity headers cannot list projects", lambda: protected("/api/projects", extra_headers=spoofed))

    passed = sum(item["passed"] for item in findings)
    print(f"\n{passed}/{len(findings)} deployment boundary checks passed.")
    print("Signed-in persistence, real account isolation, and storage durability require separate authenticated verification.")
    return 0 if passed == len(findings) else 1


if __name__ == "__main__":
    sys.exit(main())
