import unittest

from trasladar_catalogo_v11 import transfer


class TransferCatalogTests(unittest.TestCase):
    def test_mapping_fusion_labels_isolation_and_repeatability(self):
        catalog = {"schemaVersion": 1, "versions": {
            "v10": {"9": [{"name": "Legal", "url": "https://empresassk.sharepoint.com/legal"}],
                    "5": [{"name": "RF", "url": "https://empresassk.sharepoint.com/rf"}],
                    "8": [{"name": "IPER", "url": "https://empresassk.sharepoint.com/iper"}]},
            "v11": {"6": [{"name": "Propio", "url": "https://empresassk.sharepoint.com/propio"}]}}}
        mappings = [
            [6, "", "", .03, 9, "", "", "Ponderación", ""],
            [5, "", "", .03, "5 + 8", "", "", "Modificada", ""],
            [8, "", "", .03, "—", "", "", "Nueva", ""],
        ]
        result, count = transfer(catalog, mappings)
        self.assertEqual(count, 3)
        self.assertEqual(result["versions"]["v10"], catalog["versions"]["v10"])
        self.assertEqual(len(catalog["versions"]["v11"]["6"]), 1)
        self.assertEqual(len(result["versions"]["v11"]["6"]), 2)
        self.assertIn("Equivalente v10 #9", result["versions"]["v11"]["6"][1]["name"])
        self.assertEqual(len(result["versions"]["v11"]["5"]), 2)
        self.assertIn("validar alcance v11", result["versions"]["v11"]["5"][0]["name"])
        self.assertNotIn("8", result["versions"]["v11"])
        repeated, count = transfer(result, mappings)
        self.assertEqual(count, 0)
        self.assertEqual(repeated, result)


if __name__ == "__main__":
    unittest.main()
