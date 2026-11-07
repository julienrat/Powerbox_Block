import contextlib
import io
import unittest

from powerbox import facile as F


class TestFacile(unittest.TestCase):
    def setUp(self):
        with contextlib.redirect_stdout(io.StringIO()):
            F.deconnecter()
            self.box = F.connecter(simulation=True)
        self.box.verbose = False
        F.roues()
        F.vitesse_robot(100)

    def tearDown(self):
        F.deconnecter()

    def test_pourcentages(self):
        self.assertEqual(F.pourcent_vers_brut(100), 127)
        self.assertEqual(F.pourcent_vers_brut(-100), -127)
        self.assertEqual(F.pourcent_vers_brut(250), 127)
        self.assertEqual(F.pourcent_vers_brut(0), 0)
        self.assertEqual(F.brut_vers_pourcent(127), 100)

    def test_moteur(self):
        F.moteur("b", 50)
        self.assertEqual(self.box.speeds["b"], 64)
        self.assertEqual(F.vitesse_moteur("B"), 50)
        F.arreter("B")
        self.assertEqual(self.box.speeds["b"], 0)
        with self.assertRaises(ValueError):
            F.moteur("E", 10)

    def test_robot_comme_l_appli(self):
        # appli : avancer = FF sur A et D, gauche = A 7F / D FF
        F.avancer()
        self.assertEqual((self.box.speeds["a"], self.box.speeds["d"]), (-127, -127))
        F.tourner_gauche()
        self.assertEqual((self.box.speeds["a"], self.box.speeds["d"]), (127, -127))
        F.arreter_robot()
        self.assertEqual(self.box.speeds, {"a": 0, "b": 0, "c": 0, "d": 0})

    def test_roues_et_vitesse(self):
        F.roues(gauche="B", droite="C", inverser_droite=True)
        F.vitesse_robot(50)
        F.avancer()
        self.assertEqual((self.box.speeds["b"], self.box.speeds["c"]), (-64, 64))
        F.avancer(0)          # avec durée : s'arrête à la fin
        self.assertEqual((self.box.speeds["b"], self.box.speeds["c"]), (0, 0))


if __name__ == "__main__":
    unittest.main()
