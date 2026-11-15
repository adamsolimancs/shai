"""Offline regression tests for the read-only source diagnostics."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "source_probe", Path(__file__).resolve().parents[1] / "check-live-sources.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceNetworkTest(unittest.TestCase):
    def test_invalid_game_id_is_rejected_before_network_requests(self):
        with mock.patch.dict(module.os.environ, {"NBA_PROBE_GAME_ID": "invalid"}), \
                mock.patch("sys.argv", ["check-live-sources.py"]), \
                mock.patch.object(module, "check_network") as network:
            with self.assertRaises(ValueError):
                module.main()
            network.assert_not_called()

    def test_completed_tls_with_no_http_response_is_distinct_from_dns_failure(self):
        result = module.summarize_network(
            {"time_namelookup": .01, "time_connect": .03, "time_appconnect": .08,
             "time_starttransfer": 0, "time_total": 20, "http_code": 0},
            28, "", b"", "Operation timed out",
        )
        self.assertIsNone(result["http_status"])
        self.assertGreater(result["tls_seconds"], 0)
        self.assertEqual(result["first_byte_seconds"], 0)
        self.assertEqual(result["bytes_received"], 0)

    def test_html_response_reports_status_and_bounded_body(self):
        result = module.summarize_network(
            {"http_code": 403}, 0,
            "HTTP/1.1 200 Connection established\nServer: proxy\n\nHTTP/2 403\nContent-Type: text/html\nServer: AkamaiGHost\n",
            b"<HTML>Access Denied</HTML>" + b"x" * 1000,
        )
        self.assertEqual(result["http_status"], 403)
        self.assertEqual(result["server"], "AkamaiGHost")
        self.assertFalse(result["valid_json"])
        self.assertEqual(len(result["body_preview"]), 240)

    def test_valid_payload_is_not_dumped(self):
        result = module.summarize_network({"response_code": 200}, 0,
                                          "Content-Type: application/json", b'{"scoreboard": {"games": []}}')
        self.assertTrue(result["valid_json"])
        self.assertIsNone(result["body_preview"])

    def test_probe_has_deadlines_and_removes_deployment_credentials(self):
        def fake_run(args, **kwargs):
            self.assertEqual(args[:2], ["curl", "-q"])
            self.assertNotIn("Accept-Encoding: br", args)
            self.assertIn("User-Agent: fixture", args)
            self.assertEqual(kwargs["timeout"], 25)
            self.assertFalse(any(key.startswith(("DATABASE_", "UPSTASH_", "BACKEND_", "SUPABASE_"))
                                 for key in kwargs["env"]))
            Path(args[args.index("--dump-header") + 1]).write_text("Content-Type: application/json")
            Path(args[args.index("--output") + 1]).write_bytes(b"{}")
            return subprocess.CompletedProcess(args, 0, json.dumps({"http_code": 200}), "")
        with mock.patch.dict(module.os.environ, {"DATABASE_URL": "fixture-db", "UPSTASH_REDIS_REST_TOKEN": "fixture-token"}):
            result = module.probe_network("https://stats.nba.com/", {"Accept-Encoding": "br", "User-Agent": "fixture"}, run=fake_run)
        self.assertTrue(result["valid_json"])


if __name__ == "__main__":
    unittest.main()
