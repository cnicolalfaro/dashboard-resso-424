"""Private NAMI diffusion registration service."""

import os

# OpenBLAS reserves ~2 GB of address space per many-core machine, which exceeds the scan worker's
# 2 GiB RLIMIT_AS. It must be set before numpy/OpenCV load, including in the spawned scan worker.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

from .app import create_app

__all__ = ["create_app"]
