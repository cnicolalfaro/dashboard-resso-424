import hashlib
import hmac
import io
import uuid

import qrcode
from reportlab.lib.colors import HexColor, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


WIDTH, HEIGHT = A4
MARKERS = [(22, 22), (WIDTH - 22, 22), (WIDTH - 22, HEIGHT - 22), (22, HEIGHT - 22)]
ROW_HEIGHT = 36
FIRST_ROW = 225
VERSION = 2


def wrap_text(text, width, font="Helvetica", size=8):
    lines = []
    for paragraph in str(text).splitlines() or [""]:
        line = ""
        for word in paragraph.split():
            if line and stringWidth(f"{line} {word}", font, size) <= width:
                line += " " + word
                continue
            if line:
                lines.append(line)
                line = ""
            for character in word:
                if line and stringWidth(line + character, font, size) > width:
                    lines.append(line)
                    line = ""
                line += character
        lines.append(line)
    return lines


def qr_payload(record_id, version, page, total, secret):
    message = f"NAMI:{record_id}:{version}:{page}:{total}"
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()[:24]
    return f"{message}:{signature}"


def signing_keys(secret):
    """One key, or several accepted keys (shared QR key + trusted keys of other installations)."""
    return [secret] if isinstance(secret, str) else [key for key in secret if key]


def valid_payload(payload, secret):
    try:
        _, record_id, version, page, total, _ = payload.split(":")
        uuid.UUID(record_id)
        values = int(version), int(page), int(total)
        for key in signing_keys(secret):
            if hmac.compare_digest(payload.encode(), qr_payload(record_id, *values, key).encode()):
                return record_id, *values
        return None
    except (ValueError, TypeError):
        return None


def evaluation_payload(record_id, index, secret):
    """Short uppercase payload so the QR stays in alphanumeric mode and prints small."""
    message = f"NAMIE:{uuid.UUID(record_id).hex.upper()}:{index}"
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()[:12].upper()
    return f"{message}:{signature}"


def valid_evaluation_payload(payload, secret):
    try:
        tag, compact, index, _ = payload.split(":")
        record_id = str(uuid.UUID(compact))
        index = int(index)
        if tag != "NAMIE":
            return None
        for key in signing_keys(secret):
            if hmac.compare_digest(payload.encode(), evaluation_payload(record_id, index, key).encode()):
                return "evaluation", record_id, index
        return None
    except (ValueError, TypeError):
        return None


def make_document(crew, courses, date, secret):
    identifier = str(uuid.uuid4())
    participants = [dict(person) for person in crew["participants"]]
    if not participants:
        raise ValueError("No active participants in the selected crew")
    # Content is preserved verbatim in the manifest and printed in wrapped annexes.
    content_lines = []
    for course in courses:
        content_lines.extend(wrap_text(f'{course["code"]} · {course["title"]}', WIDTH - 84, size=9))
        for paragraph in course["content"].splitlines() or [""]:
            content_lines.extend(wrap_text(paragraph, WIDTH - 84, size=9))
        content_lines.append("")
    annexes = [content_lines[i:i + 40] for i in range(0, len(content_lines), 40)]
    course_lines = wrap_text("Cursos: " + " / ".join(course["code"] for course in courses) +
                             "; contenido íntegro en anexo.", WIDTH - 84, size=7)
    first_row = FIRST_ROW + (len(course_lines) - 1) * 10
    registration = [[]]
    top = first_row
    for person in participants:
        name_lines = wrap_text(person["nombre"], 310, size=8)
        detail = " / ".join(f"{label}: {person[key] or '(sin dato)'}"
                            for label, key in (("Cargo", "cargo"), ("Especialidad", "especialidad"), ("Rol", "rol")))
        detail_lines = wrap_text(detail, 310, size=7)
        height = max(ROW_HEIGHT, 13 + len(name_lines) * 10 + len(detail_lines) * 9)
        if height > HEIGHT - 100 - first_row:
            raise ValueError("Participant details exceed the printable row bounds")
        if top + height > HEIGHT - 100:
            registration.append([])
            top = first_row
        registration[-1].append((person, top, height, name_lines, detail_lines))
        top += height
    registration_pages = len(registration)
    total = registration_pages + len(annexes)
    manifest = {"id": identifier, "version": VERSION, "date": date,
                "crew": {"id": crew["id"], "name": crew["name"]},
                "participants": participants, "courses": courses, "pages": []}
    out = io.BytesIO()
    pdf = canvas.Canvas(out, pagesize=A4, pageCompression=1)
    pdf.setTitle("Registro de difusión · borrador de formato")
    for number in range(1, total + 1):
        payload = qr_payload(identifier, VERSION, number, total, secret)
        qr = qrcode.QRCode(box_size=8, border=4)
        qr.add_data(payload)
        qr.make(fit=True)
        qr_image = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        side, qx, qy = 112, WIDTH - 142, 40
        border = side * 4 / (qr.modules_count + 8)
        page = {"page": number, "rows": [], "qr": payload,
                "qr_corners": [[qx + border, qy + border],
                               [qx + side - border, qy + border],
                               [qx + side - border, qy + side - border],
                               [qx + border, qy + side - border]],
                "markers": MARKERS, "color_box": [42, 143, 12, 12]}
        manifest["pages"].append(page)
        pdf.setFillColor(black)
        for x, y in MARKERS:
            pdf.rect(x - 5, HEIGHT - y - 5, 10, 10, stroke=0, fill=1)
        pdf.drawImage(ImageReader(qr_image), qx, HEIGHT - qy - side, side, side)
        pdf.setFont("Helvetica-Bold", 12)
        pdf.drawString(42, HEIGHT - 54, "REGISTRO DE DIFUSIÓN")
        pdf.setFont("Helvetica", 7)
        pdf.drawString(42, HEIGHT - 72, "Registro de difusión · borrador de formato, validar SGR-R-006.DCH")
        pdf.setFont("Helvetica", 8)
        context = wrap_text(f'Cuadrilla {crew["id"]} · {crew["name"]} · {date}', qx - 50, size=8)
        if len(context) > 4:
            raise ValueError("Crew heading exceeds printable bounds")
        for index, line in enumerate(context):
            pdf.drawString(42, HEIGHT - 89 - index * 10, line)
        pdf.setFont("Helvetica", 7)
        pdf.drawString(42, HEIGHT - 132, "Difusión NO equivale a evaluación ni aprobación de competencia.")
        pdf.setFillColor(HexColor("#0075bd"))
        pdf.rect(42, HEIGHT - 155, 12, 12, fill=1, stroke=0)
        pdf.setFillColor(black)
        pdf.drawString(60, HEIGHT - 151, "Control de color: conservar visible en el escaneo")
        pdf.setFont("Helvetica", 7)
        pdf.drawString(42, 38, f"UUID {identifier} · versión {VERSION} · página {number}/{total}")
        if number <= registration_pages:
            for index, line in enumerate(course_lines):
                pdf.drawString(42, HEIGHT - 175 - index * 10, line)
            offset = first_row - FIRST_ROW
            pdf.drawString(42, HEIGHT - 190 - offset, "Una firma por persona para la difusión de TODOS los cursos indicados.")
            pdf.drawString(42, HEIGHT - 202 - offset, "Ausencia: trazo rojo horizontal desde RUT hasta FIRMA; confirmar cada resultado.")
            pdf.setFont("Helvetica-Bold", 8)
            for x, label in [(44, "RUT"), (116, "NOMBRE / CARGO / ESPECIALIDAD / ROL"), (440, "FIRMA")]:
                pdf.drawString(x, HEIGHT - 218 - offset, label)
            for index, (person, top, height, name_lines, detail_lines) in enumerate(registration[number - 1]):
                row = {"id": f"{identifier}:{number}:{index}", "rut": person["rut"],
                       "nombre": person["nombre"], "box": [42, top, WIDTH - 84, height],
                       "rut_x": 48, "signature_x": 440}
                page["rows"].append(row)
                pdf.rect(42, HEIGHT - top - height, WIDTH - 84, height)
                for x in (112, 430):
                    pdf.line(x, HEIGHT - top, x, HEIGHT - top - height)
                pdf.setFont("Helvetica", 8)
                pdf.drawString(45, HEIGHT - top - 20, person["rut"])
                for line_index, line in enumerate(name_lines):
                    pdf.drawString(116, HEIGHT - top - 13 - line_index * 10, line)
                pdf.setFont("Helvetica", 7)
                detail_top = top + 13 + (len(name_lines) - 1) * 10 + 12
                for line_index, line in enumerate(detail_lines):
                    pdf.drawString(116, HEIGHT - detail_top - line_index * 9, line)
        else:
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(42, HEIGHT - 185, "ANEXO: contenido de la difusión")
            pdf.setFont("Helvetica", 9)
            for index, line in enumerate(annexes[number - registration_pages - 1]):
                pdf.drawString(42, HEIGHT - 210 - index * 13, line)
        pdf.showPage()
    pdf.save()
    return manifest, out.getvalue()
