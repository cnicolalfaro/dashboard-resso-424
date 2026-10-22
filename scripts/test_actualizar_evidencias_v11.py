import tempfile
import unittest
from pathlib import Path

import openpyxl

import actualizar_evidencias_v11 as v11


class V11Tests(unittest.TestCase):
    def test_formula_results_and_pending_are_calculated_from_levels(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "v11.xlsx"
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet["A29"] = "N°"
            for n, level in enumerate((1, .75, .5, None, "N/A", 0), start=1):
                row = n + 29
                values = [n, "A. PLAN", "A1. Programa", f"Pregunta {n}", .04, level,
                          f"=E{row}*F{row}", None, None, None, "Criterio",
                          "Observación anterior", "Observación nueva", "Acción", "Responsable"]
                for col, value in enumerate(values, start=1):
                    sheet.cell(row, col, value)
            sheet["P30"] = "Abrir SharePoint"
            sheet["P30"].hyperlink = "https://empresassk.sharepoint.com/evidencia"
            workbook.save(path)
            rows = v11.load(path)
        self.assertEqual([r["status"] for r in rows],
                         ["Cumple", "Brecha menor", "Brecha relevante", "Pendiente", "No aplica", "Crítico"])
        self.assertEqual([r["priority"] for r in rows], ["Baja", "Alta", "Alta", "—", "—", "Alta"])
        self.assertEqual(rows[1]["result"], .03)
        self.assertEqual(rows[1]["gap"], .01)
        self.assertIsNone(rows[3]["level"])
        self.assertIsNone(rows[3]["result"])
        self.assertEqual(rows[0]["observation"], "Observación nueva")
        self.assertEqual(rows[0]["evidence_ref"], "https://empresassk.sharepoint.com/evidencia")
        s = v11.stats(rows)
        self.assertEqual((s["n"], s["napp"], s["pending"], s["na"], s["gap"]), (6, 4, 1, 1, 3))
        self.assertEqual(s["pct"], 56.25)

    def test_v11_template_isolates_storage_and_local_service(self):
        text = v11.auditor_page([], "22-10-2026")
        self.assertIn('"resso424_v11_auditor_evidence_links_v1"', text)
        self.assertNotIn('"resso424_auditor_evidence_links_v1"', text)
        self.assertNotIn("127.0.0.1:8765", text)
        self.assertNotIn("/upload?", text)
        self.assertNotIn("PHASE_FOLDER", text)
        self.assertIn('id="evidenceMsg"', text)
        self.assertIn("05 RESSO V11", text)
        self.assertIn("${r.id} versión 11", text)


if __name__ == "__main__":
    unittest.main()
