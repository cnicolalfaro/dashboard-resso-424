"""Registros reconocibles desde otras instalaciones: clave QR compartida y carpeta común."""
import json
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path

from .documents import evaluation_payload, qr_payload, valid_evaluation_payload, valid_payload
from .shared import shared_dir, sync_records
from .storage import connect, initialize, load_manifests, private_root, transaction

SHARED_KEY = "clave-qr-compartida-por-todas-las-instalaciones-0001"
OLD_KEY = "clave-antigua-de-otra-instalacion-que-ya-imprimio-0002"
OTHER_KEY = "clave-de-una-instalacion-no-autorizada-xxxxxxxxxx-0003"


def manifest(record_id):
    return {"id": record_id, "date": "2026-10-13", "crew": {"name": "Cuadrilla 5"}, "pages": [{"page": 1}],
            "participants": [{"rut": "11111111-1", "nombre": "PERSONA SINTETICA"}],
            "courses": [{"id": "rf1", "code": "RF-01"}], "evaluations_pdf": f"{record_id}-evaluaciones.pdf"}


class SharedRecordsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.a = private_root(str(base / "pc_a"))
        self.b = private_root(str(base / "pc_b"))
        for root in (self.a, self.b):
            initialize(root)
        self.shared = shared_dir(str(base / "onedrive" / "NAMI_REGISTROS"), self.a)

    def tearDown(self):
        self.tmp.cleanup()

    def add_record(self, root):
        record_id = str(uuid.uuid4())
        (root / "records" / f"{record_id}.pdf").write_bytes(b"%PDF registro")
        (root / "records" / f"{record_id}-evaluaciones.pdf").write_bytes(b"%PDF evaluaciones")
        with transaction(root) as db:
            db.execute("INSERT INTO records(id,manifest,pdf) VALUES (?,?,?)",
                       (record_id, json.dumps(manifest(record_id)), f"{record_id}.pdf"))
        return record_id

    def test_record_generated_on_one_pc_is_known_on_the_other(self):
        record_id = self.add_record(self.a)
        self.assertEqual(sync_records(self.a, self.shared)["exported"], 1)
        self.assertEqual(sync_records(self.b, self.shared)["imported"], 1)
        self.assertEqual(load_manifests(self.b)[record_id]["crew"]["name"], "Cuadrilla 5")
        self.assertTrue((self.b / "records" / f"{record_id}.pdf").is_file())
        self.assertTrue((self.b / "records" / f"{record_id}-evaluaciones.pdf").is_file())
        # Una segunda pasada no duplica ni reescribe nada.
        self.assertEqual(sync_records(self.b, self.shared), {"exported": 0, "imported": 0, "skipped": 0})

    def test_both_directions_and_local_records_are_never_replaced(self):
        mine, theirs = self.add_record(self.a), self.add_record(self.b)
        sync_records(self.a, self.shared)
        sync_records(self.b, self.shared)
        sync_records(self.a, self.shared)
        self.assertEqual(set(load_manifests(self.a)), {mine, theirs})
        self.assertEqual(set(load_manifests(self.b)), {mine, theirs})
        (self.shared / f"{mine}.json").write_text(json.dumps({**manifest(mine), "crew": {"name": "ALTERADO"}}))
        sync_records(self.a, self.shared)
        self.assertEqual(load_manifests(self.a)[mine]["crew"]["name"], "Cuadrilla 5")

    def test_invalid_or_unsafe_shared_files_are_ignored(self):
        bad_id = str(uuid.uuid4())
        (self.shared / f"{bad_id}.json").write_text(json.dumps({"id": "otro"}))
        unsafe = str(uuid.uuid4())
        (self.shared / f"{unsafe}.json").write_text(json.dumps({**manifest(unsafe), "evaluations_pdf": "../../x.pdf"}))
        (self.shared / "no-es-uuid.json").write_text("{}")
        self.assertEqual(sync_records(self.b, self.shared)["skipped"], 2)
        with closing(connect(self.b)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM records").fetchone()[0], 0)

    def test_shared_dir_cannot_be_inside_private_data(self):
        with self.assertRaises(ValueError):
            shared_dir(str(self.a / "compartida"), self.a)
        self.assertIsNone(shared_dir("", self.a))

    def test_qr_signed_with_shared_or_trusted_key_is_accepted(self):
        record_id = str(uuid.uuid4())
        keys = [SHARED_KEY, OLD_KEY]
        self.assertIsNotNone(valid_payload(qr_payload(record_id, 2, 1, 1, SHARED_KEY), keys))
        self.assertIsNotNone(valid_payload(qr_payload(record_id, 2, 1, 1, OLD_KEY), keys))
        self.assertIsNone(valid_payload(qr_payload(record_id, 2, 1, 1, OTHER_KEY), keys))
        self.assertIsNotNone(valid_evaluation_payload(evaluation_payload(record_id, 0, OLD_KEY), keys))
        self.assertIsNone(valid_evaluation_payload(evaluation_payload(record_id, 0, OTHER_KEY), keys))
        # Una sola clave (texto) sigue funcionando como antes.
        self.assertIsNotNone(valid_payload(qr_payload(record_id, 2, 1, 1, SHARED_KEY), SHARED_KEY))


if __name__ == "__main__":
    unittest.main()
