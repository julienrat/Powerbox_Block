import unittest

from powerbox import protocol as P


class TestFrames(unittest.TestCase):
    def test_stop_frame(self):
        self.assertEqual(P.build_frame().hex(), "fc0f010000000000000000000000000c")

    def test_motor_a_full(self):
        # trames validées sur le boîtier (moteurs qui tournent)
        self.assertEqual(P.build_frame(a=127).hex(), "fc0f017f00000000000000000000008b")
        self.assertEqual(P.build_frame(a=-127).hex(), "fc0f01ff00000000000000000000000b")

    def test_a100_dm100(self):
        f = P.build_frame(a=100, d=-100)
        self.assertEqual(f.hex(), "fc0f01640000e4000000000000000054")
        self.assertEqual(f[3], 0x64)
        self.assertEqual(f[6], 0xE4)
        self.assertEqual(f[15], sum(f[:15]) & 0xFF)

    def test_encode_decode(self):
        for v in (-127, -96, -1, 0, 1, 96, 127):
            self.assertEqual(P.decode_speed(P.encode_speed(v)), v)
        self.assertEqual(P.encode_speed(500), 0x7F)
        self.assertEqual(P.encode_speed(-500), 0xFF)

    def test_parse_frame_roundtrip(self):
        f = P.build_frame(10, -20, 30, -40, indicator=2)
        d = P.parse_frame(f)
        self.assertEqual((d["a"], d["b"], d["c"], d["d"], d["indicator"]), (10, -20, 30, -40, 2))
        self.assertTrue(d["checksum_ok"])

    def test_status(self):
        st = P.parse_status(bytes.fromhex("ca010400000000000000000000cf0000"))
        self.assertIsNotNone(st)
        self.assertEqual((st.kind, st.value), (1, 4))
        self.assertTrue(st.checksum_ok)
        self.assertIsNone(P.parse_status(b"\x00\x01"))


if __name__ == "__main__":
    unittest.main()
