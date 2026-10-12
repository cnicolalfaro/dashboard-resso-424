import re
from pathlib import Path


def course_slug(course):
    return re.sub(r"[^a-z0-9]", "", str(course["code"]).lower())


class FolderTemplates:
    """Templates kept as files in a private folder: registro.docx and eval-<course>.docx."""

    def __init__(self, directory):
        self.directory = Path(directory)

    def register(self):
        path = self.directory / "registro.docx"
        return path if path.is_file() else None

    def evaluation(self, course):
        path = self.directory / f"eval-{course_slug(course)}.docx"
        return path if path.is_file() else None

    def available(self, courses):
        return {course["id"] for course in courses if self.evaluation(course)}


def as_templates(value):
    return value if hasattr(value, "evaluation") else FolderTemplates(value)
