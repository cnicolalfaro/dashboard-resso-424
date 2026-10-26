import re
import unittest
from unittest.mock import patch

import actualizar_evidencias as evidence


class EvidenceUpdateTests(unittest.TestCase):
    def test_cutoff_changes_without_modifying_observation_dates(self):
        data = 'const DATA = [{"observation":"Documento al 21-10-2026"}];\n'
        text = "Revisión documental · 21-10-2026\n" + data + "RESSO del 21-10-2026."
        updated = evidence.replace_dates(text, [], "26-10-2026")
        self.assertIn(data, updated)
        self.assertIn("Revisión documental · 26-10-2026", updated)
        self.assertIn("RESSO del 26-10-2026.", updated)
        self.assertEqual(
            evidence.replace_dates("Estado real al 21-10-2026", [], "26-10-2026"),
            "Estado real al 26-10-2026",
        )

    def test_donut_replacement_handles_nested_variables_and_is_idempotent(self):
        text = ('.donut{background:conic-gradient(var(--green) 0 60%,#aaa 60% 100%)'
                ' 0 60%,#aaa 60% 100%);display:grid;position:relative}')
        record = dict(weight=1, result=1, status="Cumple", priority="Baja")
        total = evidence.stats([record])
        phases = {phase: total for phase, _ in evidence.PHASES}
        outputs = []
        for _ in range(2):
            with patch.object(evidence, "read", return_value=text), patch.object(evidence, "write") as write:
                evidence.update_index([record], phases, total, "26-10-2026")
                text = write.call_args.args[1]
                outputs.append(text)
        self.assertEqual(outputs[0], outputs[1])
        gradient = re.search(r"background:(.*?);display:grid", text, re.S)[1]
        self.assertEqual(gradient.count("("), gradient.count(")"))
        self.assertIn("var(--green) 0 100.00%", gradient)


if __name__ == "__main__":
    unittest.main()
